import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOAuthTokenStore,
  OsTokenStore,
  TokenStoreUnavailable,
} from "./OsTokenStore.js";

vi.mock("node:child_process", { spy: true });

type Child = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: { end: (input?: string) => void };
};

/** Minimal `security` emulator backed by an in-memory keychain. */
function fakeKeychain(
  items: Map<string, string>,
  stdinData: string[],
  fail: (args: readonly string[], input?: string) => boolean = () => false,
) {
  return (_command: string, args: readonly string[]) => {
    const child = new EventEmitter() as Child;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const finish = (code: number, out = "", err = "") => {
      child.stdout.end(out);
      child.stderr.end(err);
      setImmediate(() => child.emit("close", code));
    };
    child.stdin = {
      end: (input?: string) => {
        if (args[0] === "-i") {
          stdinData.push(input ?? "");
          let code = 0;
          let error = "";
          for (const line of (input ?? "").split("\n").filter(Boolean)) {
            if (fail(args, line)) {
              code = 1;
              error = "keychain unavailable";
              continue;
            }
            code = 0;
            error = "";
            const parts = [...line.matchAll(/'([^']*)'|(\S+)/g)].map(
              (m) => m[1] ?? m[2],
            );
            const service = parts[parts.indexOf("-s") + 1];
            if (parts[0] === "add-generic-password") {
              const hex = parts[parts.indexOf("-X") + 1];
              items.set(service, Buffer.from(hex, "hex").toString("utf8"));
            } else if (parts[0] === "delete-generic-password") {
              if (!items.delete(service)) {
                code = 44;
                error = "The specified item could not be found";
              }
            }
          }
          return finish(code, "", error);
        }
        if (fail(args)) return finish(1, "", "keychain unavailable");
        const service = args[args.indexOf("-s") + 1];
        const value = items.get(service);
        if (value === undefined) {
          return finish(44, "", "The specified item could not be found");
        }
        if (args[0] === "delete-generic-password") items.delete(service);
        return finish(0, args[0] === "find-generic-password" ? value : "");
      },
    };
    return child as never;
  };
}

const tokenSet = {
  accessToken: "a".repeat(5000),
  refreshToken: "r".repeat(2500),
  tokenType: "Bearer" as const,
  expiresAt: 1,
};

describe("OsTokenStore macOS", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the CLI's issuer and client identity for OAuth credentials", async () => {
    vi.mocked(childProcess.spawn).mockImplementation(
      fakeKeychain(new Map(), []),
    );
    const store = createOAuthTokenStore(
      { issuer: "https://issuer.example", clientId: "test-client" },
      "darwin",
    );
    await expect(store.load()).resolves.toBeNull();
    expect(vi.mocked(childProcess.spawn).mock.calls[0][1]).toEqual([
      "find-generic-password",
      "-a",
      "test-client",
      "-s",
      "OpenCircuit/https://issuer.example",
      "-w",
    ]);
  });

  it("stores large tokens in bounded security -i lines and reloads them", async () => {
    const items = new Map<string, string>();
    const stdinData: string[] = [];
    vi.mocked(childProcess.spawn).mockImplementation(
      fakeKeychain(items, stdinData),
    );
    const store = new OsTokenStore("svc", "acct", "darwin");

    await store.save(tokenSet);

    const json = JSON.stringify(tokenSet);
    const hex = Buffer.from(json, "utf8").toString("hex");
    for (const [, args] of vi.mocked(childProcess.spawn).mock.calls) {
      expect((args as string[]).join(" ")).not.toContain(json.slice(0, 40));
      expect((args as string[]).join(" ")).not.toContain(hex.slice(0, 40));
    }
    const lines = stdinData.join("").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line.length).toBeLessThan(4000);
    expect(lines.at(-1)).toContain("-s 'svc' ");
    expect(items.get("svc")).toMatch(/^oc-chunks:\d+$/);
    await expect(store.load()).resolves.toEqual(tokenSet);

    await store.save({ ...tokenSet, accessToken: "x", refreshToken: "y" });
    expect(items.get("svc")).toBe("oc-chunks:1");
    expect([...items.keys()].sort()).toEqual(["svc", "svc#0"]);

    await store.clear();
    expect(items.size).toBe(0);
  });

  it("still loads a legacy single-item JSON token", async () => {
    const items = new Map([["svc", JSON.stringify(tokenSet)]]);
    vi.mocked(childProcess.spawn).mockImplementation(fakeKeychain(items, []));

    await expect(
      new OsTokenStore("svc", "acct", "darwin").load(),
    ).resolves.toEqual(tokenSet);
  });

  it("does not overwrite or clear credentials when the manifest lookup fails", async () => {
    const items = new Map([
      ["svc", "oc-chunks:1"],
      ["svc#0", "existing"],
    ]);
    const stdinData: string[] = [];
    vi.mocked(childProcess.spawn).mockImplementation(
      fakeKeychain(
        items,
        stdinData,
        (args) => args[0] === "find-generic-password",
      ),
    );
    const store = new OsTokenStore("svc", "acct", "darwin");

    await expect(store.save(tokenSet)).rejects.toBeInstanceOf(
      TokenStoreUnavailable,
    );
    await expect(store.clear()).rejects.toBeInstanceOf(TokenStoreUnavailable);
    expect([...items.keys()].sort()).toEqual(["svc", "svc#0"]);
    expect(stdinData).toEqual([]);
  });

  it("preserves the manifest when chunk deletion fails so clear can be retried", async () => {
    const items = new Map([
      ["svc", "oc-chunks:2"],
      ["svc#0", "first"],
      ["svc#1", "second"],
    ]);
    let failDeletion = true;
    vi.mocked(childProcess.spawn).mockImplementation(
      fakeKeychain(
        items,
        [],
        (args) =>
          failDeletion &&
          args[0] === "delete-generic-password" &&
          args.includes("svc#1"),
      ),
    );
    const store = new OsTokenStore("svc", "acct", "darwin");

    await expect(store.clear()).rejects.toBeInstanceOf(TokenStoreUnavailable);
    expect(items.get("svc")).toBe("oc-chunks:2");
    failDeletion = false;
    await expect(store.clear()).resolves.toBeUndefined();
    expect(items.size).toBe(0);
  });

  it("rejects malformed manifests without clearing credentials", async () => {
    const items = new Map([
      ["svc", "oc-chunks:invalid"],
      ["svc#0", "existing"],
    ]);
    vi.mocked(childProcess.spawn).mockImplementation(fakeKeychain(items, []));
    const store = new OsTokenStore("svc", "acct", "darwin");

    await expect(store.clear()).rejects.toBeInstanceOf(TokenStoreUnavailable);
    expect([...items.keys()].sort()).toEqual(["svc", "svc#0"]);
  });

  it("reports an intermediate interactive store failure", async () => {
    const items = new Map([
      ["svc", "oc-chunks:1"],
      ["svc#0", "existing"],
    ]);
    vi.mocked(childProcess.spawn).mockImplementation(
      fakeKeychain(
        items,
        [],
        (args, line) => args[0] === "-i" && !!line?.includes("-s 'svc#0' "),
      ),
    );
    const store = new OsTokenStore("svc", "acct", "darwin");

    await expect(store.save(tokenSet)).rejects.toBeInstanceOf(
      TokenStoreUnavailable,
    );
    expect(items.get("svc")).toBe("oc-chunks:1");
    expect(items.get("svc#0")).toBe("existing");
  });

  it("retains the old manifest when stale chunk cleanup fails and retries", async () => {
    const items = new Map([
      ["svc", "oc-chunks:3"],
      ["svc#0", "first"],
      ["svc#1", "second"],
      ["svc#2", "third"],
    ]);
    let failDeletion = true;
    vi.mocked(childProcess.spawn).mockImplementation(
      fakeKeychain(
        items,
        [],
        (args, line) =>
          failDeletion &&
          ((args[0] === "delete-generic-password" && args.includes("svc#2")) ||
            (args[0] === "-i" &&
              !!line?.startsWith("delete-generic-password") &&
              line.includes("-s 'svc#2' "))),
      ),
    );
    const store = new OsTokenStore("svc", "acct", "darwin");
    const shortToken = { ...tokenSet, accessToken: "x", refreshToken: "y" };

    await expect(store.save(shortToken)).rejects.toBeInstanceOf(
      TokenStoreUnavailable,
    );
    expect(items.get("svc")).toBe("oc-chunks:3");
    failDeletion = false;
    await expect(store.save(shortToken)).resolves.toBeUndefined();
    expect([...items.keys()].sort()).toEqual(["svc", "svc#0"]);
    await expect(store.load()).resolves.toEqual(shortToken);
  });
});

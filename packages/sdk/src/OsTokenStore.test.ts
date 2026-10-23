import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OsTokenStore } from "./OsTokenStore.js";

vi.mock("node:child_process", { spy: true });

type Child = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: { end: (input?: string) => void };
};

/** Minimal `security` emulator backed by an in-memory keychain. */
function fakeKeychain(items: Map<string, string>, stdinData: string[]) {
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
          for (const line of (input ?? "").split("\n").filter(Boolean)) {
            const parts = [...line.matchAll(/'([^']*)'|(\S+)/g)].map(
              (m) => m[1] ?? m[2],
            );
            const service = parts[parts.indexOf("-s") + 1];
            if (parts[0] === "add-generic-password") {
              const hex = parts[parts.indexOf("-X") + 1];
              items.set(service, Buffer.from(hex, "hex").toString("utf8"));
            } else if (parts[0] === "delete-generic-password") {
              items.delete(service);
            }
          }
          return finish(0);
        }
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
});

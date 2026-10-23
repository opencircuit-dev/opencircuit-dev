import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OsTokenStore } from "./OsTokenStore.js";

vi.mock("node:child_process", { spy: true });

function fakeChild(stdinData: string[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: { end: (input?: string) => void };
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = {
    end: (input?: string) => {
      if (input !== undefined) stdinData.push(input);
      setImmediate(() => child.emit("close", 0));
    },
  };
  return child;
}

describe("OsTokenStore macOS save", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes token data as hex instead of prompting on the terminal", async () => {
    const stdinData: string[] = [];
    vi.mocked(childProcess.spawn).mockImplementation(
      () => fakeChild(stdinData) as never,
    );
    const tokenSet = {
      accessToken: "a".repeat(5000),
      refreshToken: "r".repeat(2500),
      tokenType: "Bearer" as const,
      expiresAt: 1,
    };

    await new OsTokenStore("svc", "acct", "darwin").save(tokenSet);

    const [command, args] = vi.mocked(childProcess.spawn).mock.calls[0];
    expect(command).toBe("security");
    expect(args).not.toContain("-w");
    const hex = (args as string[])[(args as string[]).indexOf("-X") + 1];
    expect(Buffer.from(hex, "hex").toString("utf8")).toBe(
      JSON.stringify(tokenSet),
    );
    expect(stdinData).toEqual([]);
  });
});

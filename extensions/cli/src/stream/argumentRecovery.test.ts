import * as path from "node:path";

import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { ArgumentRecovery, getArgumentRecovery } from "./argumentRecovery.js";
import { createTurnGuard } from "./turnGuard.js";
import { createLoopGuard, withTurnScope } from "./turnGuardLoop.js";

const call = (filepath?: string) => ({
  id: "write",
  name: "Write",
  arguments: {
    content: "hello",
    ...(filepath === undefined ? {} : { filepath }),
  },
  argumentsStr: "{}",
  startNotified: false,
});
const missing = [
  { toolCallId: "write", toolName: "Write", fields: ["filepath"] },
];
const history = (content: string): ChatHistoryItem[] => [
  { message: { role: "user", content }, contextItems: [] },
];

describe("recovery evidence and turn lifetime", () => {
  it("survives an actual compaction guard scope and resets only on a new user turn", async () => {
    await withTurnScope(async () => {
      const outer = createLoopGuard(false, false);
      const recovery = getArgumentRecovery(
        outer.enforced,
        history("Write to `requested.txt`"),
      );
      expect(recovery.begin(missing, [call()])).toBeUndefined();
      const inner = createLoopGuard(true, false);
      expect(inner.enforced).toBe(outer.enforced);
      expect(getArgumentRecovery(inner.enforced, [])).toBe(recovery);
      expect(recovery.inspect([call("requested.txt")])).toBeUndefined();
      recovery.finish(false);
      expect(recovery.begin(missing, [call()])).toContain("recovery exhausted");
    });
    await withTurnScope(async () => {
      const next = createLoopGuard(false, false);
      expect(
        getArgumentRecovery(
          next.enforced,
          history("Write to `requested.txt`"),
        ).begin(missing, [call()]),
      ).toBeUndefined();
    });
  });
  it("normalizes explicit relative destinations against the original workspace", () => {
    const recovery = new ArgumentRecovery(history("Write to ./requested.txt."));
    expect(recovery.begin(missing, [call()])).toBeUndefined();
    expect(
      recovery.inspect([call(path.resolve("requested.txt"))]),
    ).toBeUndefined();
  });
  it.each([
    "Write somewhere appropriate",
    "Write either a.txt or b.txt",
    "Write hello",
  ])("requires clarification for %s", (prompt) => {
    expect(
      new ArgumentRecovery(history(prompt)).begin(missing, [call()]),
    ).toMatch(/clarify/);
  });
  it("ignores assistant prose and failed Read calls as grounding", () => {
    const input = history("Write somewhere appropriate");
    input.push({
      message: { role: "assistant", content: "Use requested.txt" },
      contextItems: [],
    });
    input.push({
      message: { role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: "failed-read",
          status: "errored",
          parsedArgs: { filepath: "requested.txt" },
          toolCall: {
            id: "failed-read",
            type: "function",
            function: { name: "Read", arguments: "{}" },
          },
        },
      ],
    });
    expect(new ArgumentRecovery(input).begin(missing, [call()])).toMatch(
      /clarify/,
    );
  });
  it("does not mistake quoted content for an extensionless destination", () => {
    expect(
      new ArgumentRecovery(
        history('Write "hello" somewhere appropriate'),
      ).begin(missing, [call()]),
    ).toMatch(/clarify/);
  });
  it("allows an explicitly named extensionless destination", () => {
    const recovery = new ArgumentRecovery(history('Write hello to "LICENSE"'));
    expect(recovery.begin(missing, [call()])).toBeUndefined();
    expect(recovery.inspect([call("LICENSE")])).toBeUndefined();
  });
  it("captures successful Reads before recovery but never learns a guessed path during recovery", () => {
    const guard = createTurnGuard();
    const recovery = getArgumentRecovery(
      guard,
      history("Update the file we examined"),
    );
    const read = (filepath: string): ChatHistoryItem => ({
      message: { role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: "read",
          status: "done",
          parsedArgs: { filepath },
          toolCall: {
            id: "read",
            type: "function",
            function: { name: "Read", arguments: JSON.stringify({ filepath }) },
          },
        },
      ],
    });
    recovery.captureContext([read("requested.txt")]);
    expect(recovery.begin(missing, [call()])).toBeUndefined();
    recovery.captureContext([read("invented.txt")]);
    expect(recovery.inspect([call("invented.txt")])).toMatch(/clarify/);
  });
});

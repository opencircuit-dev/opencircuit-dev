import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { explicitFileTarget, getFileEditTask } from "./fileEditTask.js";
import { createTurnGuard } from "./turnGuard.js";

const history = (text: string): ChatHistoryItem[] => [
  { message: { role: "user", content: text }, contextItems: [] },
];
describe("direct file task scope", () => {
  it.each([
    "now update /tmp/severity.txt",
    "please edit the file at /tmp/severity.txt",
    "write to /tmp/severity.txt with medium",
  ])("recognizes %s", (text) =>
    expect(explicitFileTarget(text)).toBe("/tmp/severity.txt"),
  );
  it.each([
    "update dependencies",
    "Implement a fix in src/foo.ts and add tests",
    "update /tmp/foo.ts and add tests",
    "Read /tmp/foo.ts",
    "update https://example.com/a.txt",
  ])("does not constrain %s", (text) =>
    expect(explicitFileTarget(text)).toBeUndefined(),
  );
  it("does not constrain the next user turn to the previous target", () => {
    expect(
      getFileEditTask(createTurnGuard(), history("update /tmp/a.txt")).target,
    ).toBe("/tmp/a.txt");
    expect(
      getFileEditTask(createTurnGuard(), history("update /tmp/b.txt")).target,
    ).toBe("/tmp/b.txt");
  });
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistory } from "core/messageConversion.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import { services } from "../services/index.js";
import { convertToolToChatCompletionTool } from "../tools/index.js";
import { writeFileTool } from "../tools/writeFile.js";

import { handleToolCalls } from "./handleToolCalls.js";
import { createTurnGuard, DEFAULT_LIMITS } from "./turnGuard.js";

vi.hoisted(() => vi.resetModules());

vi.mock("../services/index.js", () => ({
  services: {
    chatHistory: {
      isReady: vi.fn(() => false),
      addToolResult: vi.fn(),
      addAssistantMessage: vi.fn(),
      updateToolStatus: vi.fn(),
    },
    gitAiIntegration: { trackToolUse: vi.fn() },
  },
  serviceContainer: {
    get: vi.fn(async () => ({
      permissions: { defaultPermission: "allow" },
      model: { provider: "anthropic", name: "test", model: "test" },
      tools: [],
    })),
  },
  SERVICE_NAMES: { TOOL_PERMISSIONS: "toolPermissions" },
}));
vi.mock("../permissions/permissionChecker.js", () => ({
  checkToolPermission: vi.fn(() => ({ permission: "allow" })),
}));

let dir: string;
let destination: string;
let history: ChatHistoryItem[];
let guard: ReturnType<typeof createTurnGuard>;
const onContent = vi.fn();
const originalExitCode = process.exitCode;
const onStop = vi.fn();
function call(id: string, args: unknown, name = "Write") {
  return {
    id,
    name,
    arguments: args,
    argumentsStr: JSON.stringify(args),
    startNotified: false,
  };
}
async function run(calls: ReturnType<typeof call>[], headless = false) {
  return handleToolCalls({
    toolCalls: calls,
    chatHistory: history,
    content: "",
    callbacks: { onContent },
    isHeadless: headless,
    guard,
    registryGeneration: guard.registerRegistry(["Write", "Read"]),
    onStop,
    advertisedTools: [convertToolToChatCompletionTool(writeFileTool)],
  });
}
function results() {
  return convertFromUnifiedHistory(history).filter((m) => m.role === "tool");
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkToolPermission).mockReturnValue({ permission: "allow" });
  vi.mocked(services.chatHistory.isReady).mockReturnValue(false);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-argument-recovery-"));
  destination = path.join(dir, "requested.txt");
  history = [
    {
      message: { role: "user", content: `Write hello to \`${destination}\`.` },
      contextItems: [],
    },
  ];
  guard = createTurnGuard();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = originalExitCode;
});

describe("bounded argument recovery through validation, permissions and real Write", () => {
  it("returns schema feedback then accepts one grounded model correction", async () => {
    expect(await run([call("first", { content: "hello" })])).toBe(false);
    expect(String(results()[0].content)).toContain('"filepath"');
    expect(String(results()[0].content)).toContain('"required"');
    expect(String(results()[0].content)).toMatch(/one correction/i);
    expect(fs.existsSync(destination)).toBe(false);
    expect(
      await run([
        call("correction", { filepath: destination, content: "hello" }),
      ]),
    ).toBe(false);
    expect(fs.readFileSync(destination, "utf8")).toBe("hello");
    expect(checkToolPermission).toHaveBeenCalled();
    expect(guard.snapshot().consumedCalls).toBe(2);
    expect(results()).toHaveLength(2);
  });
  it("stops for clarification immediately when the destination is unknown", async () => {
    history[0].message.content = "Write a greeting somewhere appropriate";
    expect(await run([call("first", { content: "hello" })], true)).toBe(true);
    expect(onContent).toHaveBeenCalledWith(
      expect.stringMatching(/clarif|which file/i),
    );
    expect(process.exitCode).toBe(2);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(results()).toHaveLength(1);
  });
  it("rejects a valid invented correction before Write preprocessing", async () => {
    await run([call("first", { content: "hello" })]);
    const preprocess = vi.spyOn(writeFileTool, "preprocess");
    const invented = path.join(dir, "invented.txt");
    try {
      expect(
        await run([call("new-id", { filepath: invented, content: "hello" })]),
      ).toBe(true);
      expect(preprocess).not.toHaveBeenCalled();
      expect(fs.existsSync(invented)).toBe(false);
      expect(onContent).toHaveBeenCalledWith(
        expect.stringMatching(/clarif|which file/i),
      );
    } finally {
      preprocess.mockRestore();
    }
  });
  it("stops after a changed malformed correction despite a different signature", async () => {
    await run([call("first", { content: "one" })]);
    expect(await run([call("second", { content: "two" })])).toBe(true);
    expect(onContent).toHaveBeenCalledWith(
      expect.stringMatching(/correction.*fail|recovery.*exhaust/i),
    );
    expect(results()).toHaveLength(2);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it("does not rearm recovery after a successful correction", async () => {
    await run([call("first", { content: "hello" })]);
    await run([call("second", { filepath: destination, content: "hello" })]);
    expect(await run([call("third", { content: "different" })])).toBe(true);
    expect(fs.readFileSync(destination, "utf8")).toBe("hello");
  });
  it("does not grant a retry when existing guard limits stop the turn", async () => {
    guard = createTurnGuard({
      limits: { ...DEFAULT_LIMITS, maxIdenticalFailures: 1 },
    });
    await run([call("first", { content: "hello" })]);
    expect(guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "identical_failure" },
    });
    expect(
      await run([call("second", { filepath: destination, content: "hello" })]),
    ).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
  });
  it("preserves policy denial of a grounded correction", async () => {
    await run([call("first", { content: "hello" })]);
    vi.mocked(checkToolPermission).mockReturnValue({ permission: "exclude" });
    expect(
      await run(
        [call("second", { filepath: destination, content: "hello" })],
        true,
      ),
    ).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
    expect(String(results()[1].content)).toContain(
      "blocked by security policy",
    );
  });
  it("rejects a batch of corrections without executing either write", async () => {
    await run([call("first", { content: "hello" })]);
    expect(
      await run([
        call("a", { filepath: destination, content: "one" }),
        call("b", { filepath: destination, content: "two" }),
      ]),
    ).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
    expect(results()).toHaveLength(3);
  });
  it("keeps ordinary successful calls unchanged", async () => {
    expect(
      await run([
        call("ordinary", { filepath: destination, content: "hello" }),
      ]),
    ).toBe(false);
    expect(fs.readFileSync(destination, "utf8")).toBe("hello");
    expect(onContent).not.toHaveBeenCalled();
  });
  it("keeps recovery exhausted after history is replaced by compaction", async () => {
    await run([call("first", { content: "one" })]);
    history = [];
    expect(await run([call("second", { content: "two" })])).toBe(true);
    expect(onStop).toHaveBeenCalledWith(
      expect.stringContaining("recovery exhausted"),
    );
    expect(
      await run([call("third", { filepath: destination, content: "three" })]),
    ).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
  });
  it("accepts established successful Read context", async () => {
    history[0].message.content = "Update the file we examined";
    history.unshift({
      message: { role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: "read",
          status: "done",
          parsedArgs: { filepath: destination },
          toolCall: {
            id: "read",
            type: "function",
            function: {
              name: "Read",
              arguments: JSON.stringify({ filepath: destination }),
            },
          },
        },
      ],
    });
    expect(await run([call("first", { content: "hello" })])).toBe(false);
    expect(
      await run([call("second", { filepath: destination, content: "hello" })]),
    ).toBe(false);
    expect(fs.readFileSync(destination, "utf8")).toBe("hello");
  });
  it("does not execute successful siblings from an ambiguous initial batch", async () => {
    expect(
      await run([
        call("first", { content: "one" }),
        call("sibling", { filepath: destination, content: "two" }),
      ]),
    ).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
    expect(results()).toHaveLength(2);
  });
  it("does not substitute another tool for the pending correction", async () => {
    await run([call("first", { content: "one" })]);
    expect(await run([call("second", { filepath: destination }, "Read")])).toBe(
      true,
    );
    expect(onStop).toHaveBeenCalledWith(
      expect.stringContaining("recovery exhausted"),
    );
  });
  it("saves exactly one result per call and a stop explanation through the history service", async () => {
    vi.mocked(services.chatHistory.isReady).mockReturnValue(true);
    await run([call("first", { content: "one" })]);
    expect(await run([call("second", { content: "two" })])).toBe(true);
    expect(services.chatHistory.addToolResult).toHaveBeenCalledTimes(2);
    expect(services.chatHistory.addToolResult).toHaveBeenCalledWith(
      "second",
      expect.stringContaining("filepath"),
      "errored",
    );
    expect(
      vi
        .mocked(services.chatHistory.addAssistantMessage)
        .mock.calls.at(-1)?.[0],
    ).toContain("recovery exhausted");
    expect(onStop).toHaveBeenCalledWith(
      expect.stringContaining("recovery exhausted"),
    );
  });
  it("does not treat a type error as a recoverable missing argument", async () => {
    expect(await run([call("first", { filepath: 42, content: "one" })])).toBe(
      false,
    );
    expect(String(results()[0].content)).toContain("Filepath must be a string");
    expect(String(results()[0].content)).not.toContain("one correction");
    expect(
      await run([
        call("ordinary", { filepath: destination, content: "hello" }),
      ]),
    ).toBe(false);
    expect(fs.readFileSync(destination, "utf8")).toBe("hello");
  });
  it("preserves user denial and stops recovery", async () => {
    await run([call("first", { content: "hello" })]);
    vi.mocked(checkToolPermission).mockReturnValue({ permission: "ask" });
    expect(
      await run([call("second", { filepath: destination, content: "hello" })]),
    ).toBe(true);
    expect(String(results()[1].content)).toContain("Permission denied by user");
    expect(fs.existsSync(destination)).toBe(false);
  });
  it("stops if a grounded correction fails during execution without replaying it", async () => {
    await run([call("first", { content: "hello" })]);
    fs.mkdirSync(destination);
    expect(
      await run([call("second", { filepath: destination, content: "hello" })]),
    ).toBe(true);
    expect(onStop).toHaveBeenCalledWith(
      expect.stringContaining("recovery exhausted"),
    );
    expect(fs.statSync(destination).isDirectory()).toBe(true);
    expect(results()).toHaveLength(2);
  });
  it("returns the existing call-cap stop explanation when no retry budget remains", async () => {
    guard = createTurnGuard({ limits: { ...DEFAULT_LIMITS, maxCalls: 1 } });
    await run([call("first", { content: "hello" })]);
    expect(
      await run([call("second", { filepath: destination, content: "hello" })]),
    ).toBe(true);
    expect(onStop).toHaveBeenCalledWith(
      expect.stringContaining("tool-call limit"),
    );
    expect(fs.existsSync(destination)).toBe(false);
    expect(guard.snapshot().consumedCalls).toBe(1);
    expect(results()).toHaveLength(2);
  });
});

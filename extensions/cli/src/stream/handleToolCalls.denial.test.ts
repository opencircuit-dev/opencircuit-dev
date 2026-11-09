import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistory } from "core/messageConversion.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";
import { convertToolToChatCompletionTool } from "../tools/index.js";
import { readFileTool } from "../tools/readFile.js";
import { runTerminalCommandTool } from "../tools/runTerminalCommand.js";
import { writeFileTool } from "../tools/writeFile.js";

import { handleToolCalls } from "./handleToolCalls.js";
import { createTurnGuard } from "./turnGuard.js";

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
      permissions: { policies: [{ tool: "*", permission: "allow" }] },
      model: { provider: "anthropic", name: "test", model: "test" },
      tools: [],
    })),
  },
  SERVICE_NAMES: { TOOL_PERMISSIONS: "toolPermissions" },
}));
const call = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  arguments: args,
  argumentsStr: JSON.stringify(args),
  startNotified: false,
});
let directory: string;
let file: string;
let history: ChatHistoryItem[];
const originalExitCode = process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "oc-denial-"));
  file = path.join(directory, "severity.txt");
  fs.writeFileSync(file, "high");
  history = [
    {
      message: { role: "user", content: `Investigate the command for ${file}` },
      contextItems: [],
    },
  ];
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
  process.exitCode = originalExitCode;
});

describe("phase 2: first denial ends the turn", () => {
  it.each([false, true])(
    "stops without a retry, including later invocation, headless=%s",
    async (isHeadless) => {
      const guard = createTurnGuard();
      const onStop = vi.fn();
      const onContent = vi.fn();
      const run = (toolCalls: ReturnType<typeof call>[]) =>
        handleToolCalls({
          toolCalls,
          chatHistory: history,
          content: "",
          callbacks: { onContent },
          onStop,
          isHeadless,
          guard,
          registryGeneration: guard.registerRegistry(["Bash", "Read", "Write"]),
          advertisedTools: [
            readFileTool,
            runTerminalCommandTool,
            writeFileTool,
          ].map(convertToolToChatCompletionTool),
        });
      const shell = vi.spyOn(runTerminalCommandTool, "run");
      expect(
        await run([
          call("first", "Bash", { command: `echo medium | sudo tee ${file}` }),
        ]),
      ).toBe(true);
      expect(onStop).toHaveBeenCalledWith(
        expect.stringContaining("Privilege escalation (sudo) is prohibited"),
      );
      expect(
        await run([
          call("changed-id", "Write", { filepath: file, content: "medium" }),
        ]),
      ).toBe(true);
      expect(shell).not.toHaveBeenCalled();
      expect(fs.readFileSync(file, "utf8")).toBe("high");
      expect(guard.snapshot().consumedCalls).toBe(1);
      expect(onContent).toHaveBeenCalledWith(
        expect.stringContaining("No further tools will run this turn"),
      );
    },
  );
  it.each([0, 1, 2])(
    "cancels the entire batch when denied tool is at index %s",
    async (index) => {
      const guard = createTurnGuard();
      const onStop = vi.fn();
      const inputs = [
        call("read", "Read", { filepath: file }),
        call("write", "Write", { filepath: file, content: "medium" }),
      ];
      inputs.splice(
        index,
        0,
        call("denied", "Bash", { command: `sudo tee ${file}` }),
      );
      const read = vi.spyOn(readFileTool, "run");
      const write = vi.spyOn(writeFileTool, "run");
      expect(
        await handleToolCalls({
          toolCalls: inputs,
          chatHistory: history,
          content: "",
          callbacks: undefined,
          onStop,
          isHeadless: false,
          guard,
          registryGeneration: guard.registerRegistry(["Read", "Write", "Bash"]),
          advertisedTools: [
            readFileTool,
            writeFileTool,
            runTerminalCommandTool,
          ].map(convertToolToChatCompletionTool),
        }),
      ).toBe(true);
      expect(onStop).toHaveBeenCalledWith(
        expect.stringContaining("Privilege escalation (sudo) is prohibited"),
      );
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(fs.readFileSync(file, "utf8")).toBe("high");
      const results = convertFromUnifiedHistory(history).filter(
        (x) => x.role === "tool",
      );
      expect(results).toHaveLength(3);
      expect(new Set(results.map((x) => x.tool_call_id)).size).toBe(3);
      expect(
        results.every((x) => String(x.content).includes("did not execute")),
      ).toBe(true);
    },
  );
  it("stores the stop on service history too", async () => {
    vi.mocked(services.chatHistory.isReady).mockReturnValueOnce(true);
    const stopped = await handleToolCalls({
      toolCalls: [call("denied", "Bash", { command: "sudo tee /tmp/example" })],
      chatHistory: history,
      content: "",
      callbacks: undefined,
      isHeadless: false,
      advertisedTools: [runTerminalCommandTool].map(
        convertToolToChatCompletionTool,
      ),
    });
    expect(stopped).toBe(true);
    expect(services.chatHistory.addAssistantMessage).toHaveBeenCalledWith(
      expect.stringContaining("No further tools will run this turn"),
      undefined,
      undefined,
    );
  });
});

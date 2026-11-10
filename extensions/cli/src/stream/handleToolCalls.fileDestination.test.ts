import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistory } from "core/messageConversion.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { editTool } from "../tools/edit.js";
import { convertToolToChatCompletionTool } from "../tools/index.js";
import { multiEditTool } from "../tools/multiEdit.js";
import { readFileTool } from "../tools/readFile.js";
import { runTerminalCommandTool } from "../tools/runTerminalCommand.js";
import { writeFileTool } from "../tools/writeFile.js";
import { isModelCapable } from "../utils/modelCapability.js";

import { handleToolCalls } from "./handleToolCalls.js";
import { createTurnGuard } from "./turnGuard.js";

vi.mock("../utils/modelCapability.js", () => ({
  isModelCapable: vi.fn(() => false),
}));
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
let target: string;
let typo: string;
let history: ChatHistoryItem[];
let guard: ReturnType<typeof createTurnGuard>;
const onStop = vi.fn();
const originalExitCode = process.exitCode;
const tools = [
  readFileTool,
  writeFileTool,
  editTool,
  multiEditTool,
  runTerminalCommandTool,
];
const run = (calls: ReturnType<typeof call>[]) =>
  handleToolCalls({
    toolCalls: calls,
    chatHistory: history,
    content: "",
    callbacks: undefined,
    onStop,
    isHeadless: false,
    guard,
    registryGeneration: guard.registerRegistry(tools.map((t) => t.name)),
    advertisedTools: tools.map(convertToolToChatCompletionTool),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isModelCapable).mockReturnValue(false);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "oc-destination-"));
  target = path.join(
    directory,
    "project/config/rules/rule-000010/severity.txt",
  );
  typo = target.replace("rule-000010", "rul-000010");
  for (const f of [target, typo]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "high");
  }
  history = [
    {
      message: { role: "user", content: `now update ${target}` },
      contextItems: [],
    },
  ];
  guard = createTurnGuard();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
  process.exitCode = originalExitCode;
});

describe("phase 3: preserve an explicit single-file destination", () => {
  it.each(["Write", "Edit", "MultiEdit"])(
    "rejects a changed %s destination even after a successful Read",
    async (name) => {
      await run([call("read", "Read", { filepath: typo })]);
      const args =
        name === "Write"
          ? { filepath: typo, content: "medium" }
          : name === "Edit"
            ? { file_path: typo, old_string: "high", new_string: "medium" }
            : {
                file_path: typo,
                edits: [{ old_string: "high", new_string: "medium" }],
              };
      expect(await run([call("typo", name, args)])).toBe(true);
      expect(onStop).toHaveBeenCalledWith(
        expect.stringContaining(
          "destination differs from the user's explicit file",
        ),
      );
      expect(fs.readFileSync(target, "utf8")).toBe("high");
      expect(fs.readFileSync(typo, "utf8")).toBe("high");
    },
  );
  it("cancels valid siblings before any write when one destination differs", async () => {
    expect(
      await run([
        call("good", "Write", { filepath: target, content: "medium" }),
        call("bad", "Write", { filepath: typo, content: "medium" }),
      ]),
    ).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("high");
    expect(fs.readFileSync(typo, "utf8")).toBe("high");
    expect(
      convertFromUnifiedHistory(history).filter((m) => m.role === "tool"),
    ).toHaveLength(2);
  });
  it("keeps the original target across compaction and does not grant a corrected retry", async () => {
    await run([call("wrong", "Write", { filepath: typo, content: "medium" })]);
    history = [
      {
        message: { role: "user", content: `summary: update ${typo}` },
        contextItems: [],
      },
    ];
    expect(
      await run([
        call("changed", "Write", { filepath: target, content: "medium" }),
      ]),
    ).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("high");
  });
  it.each(["Write", "Edit", "MultiEdit"])(
    "permits an exact %s destination after Read",
    async (name) => {
      vi.mocked(isModelCapable).mockReturnValue(name === "MultiEdit");
      await run([call("read", "Read", { filepath: target })]);
      const args =
        name === "Write"
          ? { filepath: target, content: "medium" }
          : name === "Edit"
            ? { file_path: target, old_string: "high", new_string: "medium" }
            : {
                file_path: target,
                edits: [{ old_string: "high", new_string: "medium" }],
              };
      expect(await run([call("exact", name, args)])).toBe(false);
      expect(fs.readFileSync(target, "utf8")).toBe("medium");
      expect(fs.readFileSync(typo, "utf8")).toBe("high");
    },
  );
  it("accepts quoted destinations with spaces and equivalent relative paths", async () => {
    target = path.join(directory, "a file.txt");
    fs.writeFileSync(target, "high");
    history = [
      {
        message: {
          role: "user",
          content: `please update \`${target}\` to medium`,
        },
        contextItems: [],
      },
    ];
    expect(
      await run([
        call("relative", "Write", {
          filepath: path.relative(process.cwd(), target),
          content: "medium",
        }),
      ]),
    ).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("medium");
  });
  it("leaves a broader coding task free to write related files", async () => {
    history = [
      {
        message: {
          role: "user",
          content: `Implement validation in ${target} and add appropriate tests`,
        },
        contextItems: [],
      },
    ];
    expect(
      await run([
        call("related", "Write", { filepath: typo, content: "test fixture" }),
      ]),
    ).toBe(false);
    expect(fs.readFileSync(typo, "utf8")).toBe("test fixture");
  });
  it("phase 4: refuses Bash even when a stale registry advertises it", async () => {
    const shell = vi
      .spyOn(runTerminalCommandTool, "run")
      .mockResolvedValue("unexpected execution");
    expect(await run([call("shell", "Bash", { command: "echo benign" })])).toBe(
      true,
    );
    expect(shell).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledWith(
      expect.stringContaining("Use Read followed by Edit or Write"),
    );
  });
  it("does not override a configured denial for an exact destination", async () => {
    const permission = await import("../permissions/permissionChecker.js");
    vi.spyOn(permission, "checkToolPermission").mockReturnValue({
      permission: "exclude",
    });
    expect(
      await run([
        call("exact", "Write", { filepath: target, content: "medium" }),
      ]),
    ).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("high");
  });
});

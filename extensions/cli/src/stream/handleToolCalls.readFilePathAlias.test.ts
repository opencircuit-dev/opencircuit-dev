import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistory } from "core/messageConversion.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import { convertToolToChatCompletionTool } from "../tools/index.js";
import { readFileTool } from "../tools/readFile.js";
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

let directory: string;
let filepath: string;
let history: ChatHistoryItem[];
let guard: ReturnType<typeof createTurnGuard>;
const onContent = vi.fn();
const exitCode = process.exitCode;
const call = (id: string, args: Record<string, unknown>, name = "Read") => ({
  id,
  name,
  arguments: args,
  argumentsStr: JSON.stringify(args),
  startNotified: false,
});
async function run(item: ReturnType<typeof call>, isHeadless = false) {
  return handleToolCalls({
    toolCalls: [item],
    chatHistory: history,
    content: "",
    callbacks: { onContent },
    isHeadless,
    guard,
    registryGeneration: guard.registerRegistry(["Read", "Write"]),
    advertisedTools: [readFileTool, writeFileTool].map(
      convertToolToChatCompletionTool,
    ),
  });
}
function results() {
  return convertFromUnifiedHistory(history).filter(
    (message) => message.role === "tool",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkToolPermission).mockReturnValue({ permission: "allow" });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "oc-read-alias-"));
  filepath = path.join(directory, "iosxe-ikev2-ipsec");
  fs.writeFileSync(filepath, "fixture configuration");
  history = [
    {
      message: { role: "user", content: "Read the configuration we selected" },
      contextItems: [],
    },
  ];
  guard = createTurnGuard();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
  process.exitCode = exitCode;
});

describe("observed Read.file_path payload recovery", () => {
  it("reads the exact supplied file on the first call using the proven alias", async () => {
    const input = call("observed", { file_path: filepath });
    expect(await run(input)).toBe(false);
    expect(String(results()[0].content)).toContain("fixture configuration");
    expect(checkToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Read", arguments: { filepath } }),
      expect.anything(),
    );
    expect(input.arguments).toEqual({ file_path: filepath });
    expect(guard.snapshot().consumedCalls).toBe(1);
    expect(guard.snapshot().identicalFailures).toBe(0);
    expect(onContent).not.toHaveBeenCalled();
  });
  it("accepts the alias within the single permitted model correction", async () => {
    await run(call("missing", {}));
    expect(await run(call("corrected", { file_path: filepath }))).toBe(false);
    expect(String(results()[1].content)).toContain("fixture configuration");
    expect(guard.snapshot().consumedCalls).toBe(2);
    expect(guard.snapshot().identicalFailures).toBe(1);
  });
  it("checks the canonical path against policy and preserves denial", async () => {
    vi.mocked(checkToolPermission).mockReturnValue({ permission: "exclude" });
    const read = vi.spyOn(readFileTool, "run");
    expect(await run(call("blocked", { file_path: filepath }), true)).toBe(
      true,
    );
    expect(checkToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: { filepath } }),
      expect.anything(),
    );
    expect(read).not.toHaveBeenCalled();
    expect(String(results()[0].content)).toContain(
      "blocked by security policy",
    );
  });
  it("still applies Read security preprocessing to the normalized path", async () => {
    const protectedPath = path.join(directory, ".env");
    fs.writeFileSync(protectedPath, "fixture protected content");
    const read = vi.spyOn(readFileTool, "run");
    await run(call("protected", { file_path: protectedPath }));
    expect(read).not.toHaveBeenCalled();
    expect(String(results()[0].content)).toContain("security concern");
    expect(String(results()[0].content)).not.toContain(
      "fixture protected content",
    );
  });
  it("does not turn a missing file into a guessed existing path", async () => {
    const misspelled = path.join(directory, "iosxe-ikev2-psec");
    await run(call("typo", { file_path: misspelled }));
    expect(String(results()[0].content)).toContain(
      `File does not exist: ${misspelled}`,
    );
    expect(String(results()[0].content)).not.toContain("fixture configuration");
  });
  it("uses a successful alias Read as established context for grounded Write recovery", async () => {
    await run(call("read", { file_path: filepath }));
    expect(
      await run(call("write-missing", { content: "replacement" }, "Write")),
    ).toBe(false);
    expect(
      await run(
        call("write-corrected", { filepath, content: "replacement" }, "Write"),
      ),
    ).toBe(false);
    expect(fs.readFileSync(filepath, "utf8")).toBe("replacement");
  });
  it("does not normalize unproven Write aliases", async () => {
    await run(
      call("write", { file_path: filepath, content: "replacement" }, "Write"),
    );
    expect(fs.readFileSync(filepath, "utf8")).toBe("fixture configuration");
    expect(String(results()[0].content)).toContain(
      'Required parameter "filepath" missing',
    );
  });
  it("leaves ambiguous alias payloads bounded instead of choosing a path", async () => {
    const args = {
      file_path: filepath,
      path: path.join(directory, "another-file"),
    };
    expect(await run(call("first", args))).toBe(false);
    expect(await run(call("second", args))).toBe(true);
    expect(
      results().every((entry) =>
        String(entry.content).includes('Required parameter "filepath" missing'),
      ),
    ).toBe(true);
    expect(onContent).toHaveBeenCalledWith(
      expect.stringContaining("recovery exhausted"),
    );
  });
  it("does not grant another call when the existing guard is exhausted", async () => {
    guard = createTurnGuard({ limits: { ...DEFAULT_LIMITS, maxCalls: 1 } });
    await run(call("first", {}));
    const read = vi.spyOn(readFileTool, "run");
    expect(await run(call("second", { file_path: filepath }))).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(guard.snapshot().consumedCalls).toBe(1);
  });
  it("counts equivalent alias and canonical failures against the same guard signature", async () => {
    guard = createTurnGuard({
      limits: { ...DEFAULT_LIMITS, maxIdenticalFailures: 2 },
    });
    const missing = path.join(directory, "missing-file");
    await run(call("alias", { file_path: missing }));
    await run(call("canonical", { filepath: missing }));
    expect(guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "identical_failure" },
    });
    expect(guard.snapshot().consumedCalls).toBe(2);
  });
});

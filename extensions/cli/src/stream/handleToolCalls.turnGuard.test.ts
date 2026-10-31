import { beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { handleToolCalls } from "./handleToolCalls.js";
import {
  executeStreamedToolCalls,
  preprocessStreamedToolCalls,
} from "./streamChatResponse.helpers.js";
import { createTurnGuard, DEFAULT_LIMITS } from "./turnGuard.js";

vi.mock("../services/index.js", () => ({
  services: {
    chatHistory: {
      isReady: vi.fn().mockReturnValue(true),
      addAssistantMessage: vi.fn(),
      addToolResult: vi.fn(),
    },
  },
  serviceContainer: { get: vi.fn() },
  SERVICE_NAMES: { TOOL_PERMISSIONS: "toolPermissions" },
}));

vi.mock("./streamChatResponse.helpers.js", () => ({
  preprocessStreamedToolCalls: vi.fn(),
  executeStreamedToolCalls: vi.fn(),
}));

const call = (id: string, name = "Bash") => ({
  id,
  name,
  arguments: { command: "npm i" },
  argumentsStr: "{}",
  startNotified: false,
});

function run(
  guard: ReturnType<typeof createTurnGuard>,
  gen: number,
  calls: any[],
) {
  return handleToolCalls({
    toolCalls: calls,
    chatHistory: [],
    content: "",
    callbacks: undefined,
    isHeadless: true,
    guard,
    registryGeneration: gen,
  });
}

describe("handleToolCalls turn guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(services.chatHistory.isReady).mockReturnValue(true);
    vi.mocked(preprocessStreamedToolCalls).mockImplementation(
      async (_h, calls) =>
        ({ preprocessedCalls: calls, errorChatEntries: [] }) as any,
    );
  });

  it("rejects an unadvertised tool before history or execution", async () => {
    const guard = createTurnGuard();
    const gen = guard.registerRegistry(["Read"]);
    expect(await run(guard, gen, [call("a", "Bash")])).toBe(true);
    expect(services.chatHistory.addAssistantMessage).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(services.chatHistory.addAssistantMessage).mock.calls[0][1],
    ).toBeUndefined();
    expect(preprocessStreamedToolCalls).not.toHaveBeenCalled();
    expect(executeStreamedToolCalls).not.toHaveBeenCalled();
  });

  it("refuses a batch that crosses the cap atomically with terminal results", async () => {
    const guard = createTurnGuard({
      limits: { ...DEFAULT_LIMITS, maxCalls: 2 },
    });
    const gen = guard.registerRegistry(["Bash"]);
    expect(await run(guard, gen, [call("a"), call("b"), call("c")])).toBe(true);
    expect(executeStreamedToolCalls).not.toHaveBeenCalled();
    expect(services.chatHistory.addToolResult).toHaveBeenCalledTimes(3);
    expect(guard.snapshot().consumedCalls).toBe(0);
    expect(guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "calls" },
    });
  });

  it("stops after N identical failures", async () => {
    const guard = createTurnGuard();
    const gen = guard.registerRegistry(["Bash"]);
    vi.mocked(executeStreamedToolCalls).mockResolvedValue({
      hasRejection: false,
      chatHistoryEntries: [
        {
          role: "tool",
          tool_call_id: "x",
          content: "EALLOWSCRIPTS 139",
          status: "errored",
        },
      ],
    } as any);
    for (let i = 0; i < 5; i++) {
      expect(guard.check().ok).toBe(true);
      await run(guard, gen, [call("x")]);
    }
    expect(guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "identical_failure" },
    });
  });

  it("writes terminal results on the local-history path when the cap refuses a batch", async () => {
    vi.mocked(services.chatHistory.isReady).mockReturnValue(false);
    const guard = createTurnGuard({
      limits: { ...DEFAULT_LIMITS, maxCalls: 1 },
    });
    const gen = guard.registerRegistry(["Bash"]);
    const history: any[] = [];
    await handleToolCalls({
      toolCalls: [call("a"), call("b")],
      chatHistory: history,
      content: "",
      callbacks: undefined,
      isHeadless: true,
      guard,
      registryGeneration: gen,
    });
    const states = history.find((h) => h.toolCallStates)?.toolCallStates;
    expect(states.map((s: any) => s.status)).toEqual(["errored", "errored"]);
  });
});

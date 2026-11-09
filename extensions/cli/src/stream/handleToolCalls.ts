import type { ChatHistoryItem, ToolStatus } from "core/index.js";
import { stripImages } from "core/messageContent.js";
import { createHistoryItem } from "core/messageConversion.js";
import type { ChatCompletionTool } from "openai/resources/index.js";
import { checkToolPermission } from "src/permissions/permissionChecker.js";

import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../services/index.js";
import type { ToolPermissionServiceState } from "../services/ToolPermissionService.js";
import {
  convertToolToChatCompletionTool,
  getAllAvailableTools,
  Tool,
  ToolCall,
} from "../tools/index.js";
import { normalizeReadFileArgs } from "../tools/readFileArguments.js";

import {
  getArgumentRecovery,
  type ArgumentRecovery,
} from "./argumentRecovery.js";
import { getFileEditTask } from "./fileEditTask.js";
import {
  executeStreamedToolCalls,
  preprocessStreamedToolCalls,
  type ToolResultWithStatus,
} from "./streamChatResponse.helpers.js";
import { StreamCallbacks } from "./streamChatResponse.types.js";
import { actionClassForTool, type TurnGuard } from "./turnGuard.js";

interface HandleToolCallsOptions {
  toolCalls: ToolCall[];
  chatHistory: ChatHistoryItem[];
  content: string;
  callbacks: StreamCallbacks | undefined;
  isHeadless: boolean;
  usage?: any;
  guard?: TurnGuard;
  registryGeneration?: number;
  advertisedTools?: ChatCompletionTool[];
  argumentRecovery?: ArgumentRecovery;
  onStop?: (notice: string) => void;
}

const denialStops = new WeakMap<object, string>();

const REFUSAL_NOTICE: Record<string, string> = {
  calls:
    "Stopped: this turn reached its tool-call limit. No further tools were run. Ask me to continue if you want more.",
  unknown_tool:
    "Stopped: the model requested a tool that is not available. Nothing was run.",
  invalid_call:
    "Stopped: the model sent a malformed tool call. Nothing was run.",
};

// Stable failure identity: tool, arguments and the error text without digits,
// so timestamps and counters do not make identical failures look distinct.
function failureSignature(call: ToolCall, content: string): string {
  const text = content.replace(/\d+/g, "#").slice(0, 120);
  const args =
    call.name === "Read"
      ? (normalizeReadFileArgs(call.arguments) ?? call.arguments)
      : call.arguments;
  return `${call.name}|${JSON.stringify(args)}|${text}`;
}

function refuseAllCalls(
  toolCalls: ToolCall[],
  chatHistory: ChatHistoryItem[],
  useService: boolean,
): void {
  const chatHistorySvc = services.chatHistory;
  const lastAssistant = useService
    ? -1
    : chatHistory.findLastIndex(
        (item) => item.message.role === "assistant" && item.toolCallStates,
      );
  for (const tc of toolCalls) {
    if (useService) {
      chatHistorySvc.addToolResult(tc.id, REFUSAL_NOTICE.calls, "errored");
      continue;
    }
    const state = chatHistory[lastAssistant]?.toolCallStates?.find(
      (ts) => ts.toolCallId === tc.id,
    );
    if (state) {
      state.status = "errored";
      state.output = [
        {
          content: REFUSAL_NOTICE.calls,
          name: "Tool Result",
          description: "Tool execution result",
        },
      ];
    }
  }
  if (useService) {
    chatHistorySvc.addAssistantMessage(REFUSAL_NOTICE.calls);
  } else {
    chatHistory.push(
      createHistoryItem({ role: "assistant", content: REFUSAL_NOTICE.calls }),
    );
  }
}

function storeToolResults(
  entries: ToolResultWithStatus[],
  history: ChatHistoryItem[],
  useService: boolean,
): void {
  const assistant = history.findLast(
    (item) => item.message.role === "assistant" && item.toolCallStates,
  );
  for (const entry of entries) {
    const content = stripImages(entry.content) || "";
    if (useService) {
      services.chatHistory.addToolResult(
        entry.tool_call_id,
        content,
        entry.status,
      );
      continue;
    }
    const state = assistant?.toolCallStates?.find(
      (item) => item.toolCallId === entry.tool_call_id,
    );
    if (state) {
      state.status = entry.status;
      state.output = [
        { content, name: "Tool Result", description: "Tool execution result" },
      ];
    }
  }
}

function recordGuardResults(
  guard: TurnGuard | undefined,
  tokens: ReadonlyMap<string, string> | undefined,
  calls: ToolCall[],
  entries: ToolResultWithStatus[],
): void {
  if (!guard || !tokens) return;
  const byId = new Map(calls.map((call) => [call.id, call]));
  for (const entry of entries) {
    const call = byId.get(entry.tool_call_id);
    const token = tokens.get(entry.tool_call_id);
    if (
      !call ||
      !token ||
      (entry.status !== "done" &&
        entry.status !== "errored" &&
        entry.status !== "canceled")
    )
      continue;
    guard.record(token, {
      status: entry.status,
      actionClass: actionClassForTool(call.name),
      signature: failureSignature(call, stripImages(entry.content) || ""),
    });
  }
}

function storeAssistantText(
  options: HandleToolCallsOptions,
  useService: boolean,
  content: string,
): void {
  if (useService)
    services.chatHistory.addAssistantMessage(content, undefined, options.usage);
  else
    options.chatHistory.push(
      createHistoryItem({
        role: "assistant",
        content,
        ...(options.usage ? { usage: options.usage } : {}),
      }),
    );
}

function storeAssistantToolCalls(
  options: HandleToolCallsOptions,
  useService: boolean,
): void {
  const { toolCalls, content, usage, chatHistory } = options;
  const chatHistorySvc = services.chatHistory;
  // Create tool call states for the ChatHistoryItem
  const toolCallStates = toolCalls.map((tc) => ({
    toolCallId: tc.id,
    toolCall: {
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    },
    status: "generated" as ToolStatus,
    parsedArgs: tc.arguments,
  }));

  // Create assistant message with tool calls
  const assistantMessage = {
    role: "assistant" as const,
    content: content || "",
    toolCalls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
      ...(tc.extra_content && { extra_content: tc.extra_content }),
    })),
  };

  if (useService) {
    // Important: pass ChatCompletion-style toolCalls, not internal ToolCall[]
    chatHistorySvc.addAssistantMessage(
      assistantMessage.content || "",
      assistantMessage.toolCalls,
      usage,
    );
  } else {
    // Fallback only when service is unavailable
    const messageWithUsage = usage
      ? { ...assistantMessage, usage }
      : assistantMessage;
    chatHistory.push(createHistoryItem(messageWithUsage, [], toolCallStates));
  }
}

async function preprocessWithRecovery(
  options: HandleToolCallsOptions,
  recovery: ArgumentRecovery,
) {
  const { chatHistory, toolCalls, isHeadless, callbacks } = options;
  recovery.captureContext(chatHistory);
  const wasCorrection = recovery.pendingTool !== undefined;
  let stopNotice =
    getFileEditTask(options.guard, chatHistory).inspect(toolCalls) ??
    recovery.inspect(toolCalls);
  const {
    preprocessedCalls,
    errorChatEntries,
    missingArguments = [],
  } = stopNotice
    ? {
        preprocessedCalls: [],
        errorChatEntries: toolCalls.map((call) => ({
          role: "tool" as const,
          tool_call_id: call.id,
          content: stopNotice!,
        })),
        missingArguments: [],
      }
    : await preprocessStreamedToolCalls(
        isHeadless,
        toolCalls,
        callbacks,
        options.advertisedTools,
      );

  if (!stopNotice) {
    stopNotice = wasCorrection
      ? errorChatEntries.length
        ? recovery.finish(true)
        : undefined
      : recovery.begin(missingArguments, toolCalls);
  }
  // An ambiguous first batch or rejected correction must not run valid siblings.
  if (stopNotice) {
    for (const call of preprocessedCalls.splice(0)) {
      errorChatEntries.push({
        role: "tool",
        tool_call_id: call.id,
        content: stopNotice,
      });
    }
  }

  return { preprocessedCalls, errorChatEntries, wasCorrection, stopNotice };
}

function notifyRecoveryStop(
  options: HandleToolCallsOptions,
  recovery: ArgumentRecovery,
  notice: string,
): void {
  if (!recovery.pendingTool) return;
  options.callbacks?.onContent?.(notice);
  options.onStop?.(notice);
  if (options.isHeadless) process.exitCode = 2;
}

export async function handleToolCalls(
  options: HandleToolCallsOptions,
): Promise<boolean> {
  const {
    toolCalls,
    chatHistory,
    content,
    callbacks,
    isHeadless,
    guard,
    registryGeneration,
  } = options;
  const recovery =
    options.argumentRecovery ?? getArgumentRecovery(guard, chatHistory);
  const chatHistorySvc = services.chatHistory;
  const useService =
    typeof chatHistorySvc?.isReady === "function" && chatHistorySvc.isReady();
  const stop = (notice: string): true => {
    storeAssistantText(options, useService, notice);
    callbacks?.onContent?.(notice);
    options.onStop?.(notice);
    if (isHeadless) process.exitCode = 2;
    return true;
  };
  // The guard spans compaction; the last user item scopes callers without one.
  const turnKey =
    guard ??
    chatHistory.findLast((item) => item.message.role === "user") ??
    chatHistory;
  const previousDenial = denialStops.get(turnKey);
  if (previousDenial) return stop(previousDenial);
  // Also check after an in-flight provider request: a deadline or stricter
  // policy must not be bypassed by the recovery path.
  if (guard && !guard.check().ok) {
    return stop(
      "Stopped: the existing turn guard limit was reached. No correction or further tools were executed.",
    );
  }
  if (toolCalls.length === 0) {
    if (content) storeAssistantText(options, useService, content);
    return false;
  }

  // Reserve budget and validate tool names before anything reaches history.
  let tokens: ReadonlyMap<string, string> | undefined;
  let capRefused = false;
  if (guard && registryGeneration !== undefined) {
    const reserved = guard.reserve(
      toolCalls.map((tc) => ({ id: tc.id, name: tc.name })),
      registryGeneration,
    );
    if (reserved.ok) {
      tokens = reserved.reservation.tokens;
    } else if (reserved.reason === "calls") {
      capRefused = true;
    } else {
      const notice = REFUSAL_NOTICE[reserved.reason];
      storeAssistantText(options, useService, notice);
      notifyRecoveryStop(options, recovery, notice);
      return true;
    }
  }

  storeAssistantToolCalls(options, useService);

  if (capRefused) {
    // Keep history protocol-valid: every tool call gets a terminal result.
    refuseAllCalls(toolCalls, chatHistory, useService);
    notifyRecoveryStop(options, recovery, REFUSAL_NOTICE.calls);
    return true;
  }

  const {
    preprocessedCalls,
    errorChatEntries,
    wasCorrection,
    stopNotice: preprocessingStop,
  } = await preprocessWithRecovery(options, recovery);
  let stopNotice = preprocessingStop;

  // Store each result on its assistant tool state, never as a duplicate
  // standalone tool message. Successful execution updates service history itself.
  const preprocessingResults: ToolResultWithStatus[] = errorChatEntries.map(
    (entry) => ({ ...entry, status: "errored" }),
  );
  storeToolResults(preprocessingResults, chatHistory, useService);

  // Execute the valid preprocessed tool calls
  // Note: executeStreamedToolCalls adds tool results to toolCallStates via
  // services.chatHistory.addToolResult() internally
  const { hasRejection, rejectionMessage, chatHistoryEntries } =
    await executeStreamedToolCalls(preprocessedCalls, callbacks, isHeadless);

  if (!useService) storeToolResults(chatHistoryEntries, chatHistory, false);
  if (wasCorrection && !stopNotice) {
    stopNotice = recovery.finish(
      hasRejection ||
        errorChatEntries.length > 0 ||
        chatHistoryEntries.length !== 1 ||
        chatHistoryEntries.some((entry) => entry.status !== "done"),
    );
  }

  recordGuardResults(guard, tokens, toolCalls, [
    ...preprocessingResults,
    ...chatHistoryEntries,
  ]);

  if (hasRejection) {
    const reason = chatHistoryEntries.find(
      (entry) => entry.status === "canceled" || entry.status === "errored",
    );
    const notice = `${rejectionMessage ?? (reason ? stripImages(reason.content) : "A tool request was denied.")} No further tools will run this turn. Review the denial with the user before continuing.`;
    denialStops.set(turnKey, notice);
    if (!stopNotice) stopNotice = notice;
  }
  if (stopNotice) return stop(stopNotice);

  // Tool results are already added to toolCallStates in executeStreamedToolCalls
  // via services.chatHistory.addToolResult() - no need to add them again here.
  // Adding them again would be redundant (and previously caused duplicate tool_result messages
  // when combined with separate tool history items).
  return false;
}

export async function getRequestTools(isHeadless: boolean) {
  const availableTools = await getAllAvailableTools(isHeadless);

  const permissionsState =
    await serviceContainer.get<ToolPermissionServiceState>(
      SERVICE_NAMES.TOOL_PERMISSIONS,
    );

  const allowedTools: Tool[] = [];
  for (const tool of availableTools) {
    const result = checkToolPermission(
      { name: tool.name, arguments: {} },
      permissionsState.permissions,
    );

    if (
      result.permission === "allow" ||
      (result.permission === "ask" && !isHeadless)
    ) {
      allowedTools.push(tool);
    }
  }

  return allowedTools.map(convertToolToChatCompletionTool);
}

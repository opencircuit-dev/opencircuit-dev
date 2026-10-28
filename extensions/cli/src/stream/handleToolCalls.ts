import type { ChatHistoryItem, ToolStatus } from "core/index.js";
import { stripImages } from "core/messageContent.js";
import { createHistoryItem } from "core/messageConversion.js";
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
import { logger } from "../util/logger.js";

import {
  executeStreamedToolCalls,
  preprocessStreamedToolCalls,
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
}

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
  return `${call.name}|${JSON.stringify(call.arguments)}|${text}`;
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

export async function handleToolCalls(
  options: HandleToolCallsOptions,
): Promise<boolean> {
  const {
    toolCalls,
    chatHistory,
    content,
    callbacks,
    isHeadless,
    usage,
    guard,
    registryGeneration,
  } = options;
  const chatHistorySvc = services.chatHistory;
  const useService =
    typeof chatHistorySvc?.isReady === "function" && chatHistorySvc.isReady();
  if (toolCalls.length === 0) {
    if (content) {
      if (useService) {
        // Service-driven: write assistant message via service
        chatHistorySvc.addAssistantMessage(content, undefined, usage);
      } else {
        // Fallback only when service is unavailable
        const message: any = {
          role: "assistant",
          content,
        };
        if (usage) {
          message.usage = usage;
        }
        chatHistory.push(createHistoryItem(message));
      }
    }
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
      if (useService) {
        chatHistorySvc.addAssistantMessage(notice, undefined, usage);
      } else {
        chatHistory.push(
          createHistoryItem({ role: "assistant", content: notice }),
        );
      }
      return true;
    }
  }

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

  if (capRefused) {
    // Keep history protocol-valid: every tool call gets a terminal result.
    refuseAllCalls(toolCalls, chatHistory, useService);
    return true;
  }

  // First preprocess the tool calls
  const { preprocessedCalls, errorChatEntries } =
    await preprocessStreamedToolCalls(isHeadless, toolCalls, callbacks);

  // Add any preprocessing errors to the toolCallStates on the assistant message
  // (NOT as separate history items, which would cause duplicate tool_result messages)
  errorChatEntries.forEach((errorEntry) => {
    const errorContent = stripImages(errorEntry.content) || "";
    if (useService) {
      chatHistorySvc.addToolResult(
        errorEntry.tool_call_id,
        errorContent,
        "errored",
      );
    } else {
      // Fallback only when service is unavailable: update local tool state
      const lastAssistantIndex = chatHistory.findLastIndex(
        (item) => item.message.role === "assistant" && item.toolCallStates,
      );
      if (
        lastAssistantIndex >= 0 &&
        chatHistory[lastAssistantIndex].toolCallStates
      ) {
        const toolState = chatHistory[lastAssistantIndex].toolCallStates.find(
          (ts) => ts.toolCallId === errorEntry.tool_call_id,
        );
        if (toolState) {
          toolState.status = "errored";
          toolState.output = [
            {
              content: errorContent,
              name: `Tool Result`,
              description: "Tool execution result",
            },
          ];
        }
      }
    }
  });

  // Execute the valid preprocessed tool calls
  // Note: executeStreamedToolCalls adds tool results to toolCallStates via
  // services.chatHistory.addToolResult() internally
  const { hasRejection, chatHistoryEntries } = await executeStreamedToolCalls(
    preprocessedCalls,
    callbacks,
    isHeadless,
  );

  if (guard && tokens) {
    const byId = new Map(toolCalls.map((tc) => [tc.id, tc]));
    const note = (
      entry: { tool_call_id: string; content: unknown },
      status: "done" | "errored" | "canceled",
    ) => {
      const call = byId.get(entry.tool_call_id);
      const token = tokens.get(entry.tool_call_id);
      if (!call || !token) return;
      guard.record(token, {
        status,
        actionClass: actionClassForTool(call.name),
        signature: failureSignature(
          call,
          stripImages(entry.content as any) || "",
        ),
      });
    };
    errorChatEntries.forEach((e) => note(e, "errored"));
    chatHistoryEntries.forEach((e) => {
      if (
        e.status === "done" ||
        e.status === "errored" ||
        e.status === "canceled"
      ) {
        note(e, e.status);
      }
    });
  }

  if (isHeadless && hasRejection) {
    logger.debug(
      "Tool call rejected in headless mode - returning current content",
    );
    return true; // Signal early return needed
  }

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

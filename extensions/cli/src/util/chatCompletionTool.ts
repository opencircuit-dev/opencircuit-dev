import type { ChatCompletionTool } from "openai/resources.mjs";

/**
 * OpenAI may add non-function tools to ChatCompletionTool over time. Keep
 * function-specific CLI behavior behind this narrowing guard so unsupported
 * tool variants remain data and are preserved by callers.
 */
export type FunctionChatCompletionTool = Extract<
  ChatCompletionTool,
  { type: "function" }
>;

export function isFunctionChatCompletionTool(
  tool: ChatCompletionTool,
): tool is FunctionChatCompletionTool {
  return tool.type === "function" && "function" in tool;
}

export function getChatCompletionToolName(tool: ChatCompletionTool): string {
  return isFunctionChatCompletionTool(tool) ? tool.function.name : "custom";
}

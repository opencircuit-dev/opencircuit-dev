import type { ToolOverrideConfig } from "@opencircuit/config-yaml";
import type { ChatCompletionTool } from "openai/resources.mjs";

import { isFunctionChatCompletionTool } from "../util/chatCompletionTool.js";

/**
 * Applies tool prompt overrides from YAML config to CLI tools.
 * Supports description changes and disabling tools.
 */
export function applyChatCompletionToolOverrides(
  tools: ChatCompletionTool[],
  overrides: Record<string, ToolOverrideConfig> | undefined,
): ChatCompletionTool[] {
  if (!overrides) {
    return tools;
  }

  return tools
    .filter((tool) => {
      if (!isFunctionChatCompletionTool(tool)) {
        return true;
      }
      return !overrides[tool.function.name]?.disabled;
    })
    .map((tool) => {
      if (!isFunctionChatCompletionTool(tool)) {
        return tool;
      }

      const override = overrides[tool.function.name];
      if (!override?.description) {
        return tool;
      }
      return {
        ...tool,
        function: {
          ...tool.function,
          description: override.description,
        },
      };
    });
}

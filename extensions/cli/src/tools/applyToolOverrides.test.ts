import type { ChatCompletionTool } from "openai/resources.mjs";
import { describe, expect, it } from "vitest";

import { isFunctionChatCompletionTool } from "../util/chatCompletionTool.js";

import { applyChatCompletionToolOverrides } from "./applyToolOverrides.js";

describe("applyChatCompletionToolOverrides", () => {
  const functionTool = (tool: ChatCompletionTool) => {
    if (!isFunctionChatCompletionTool(tool)) {
      throw new Error("Expected a function tool in this test fixture");
    }
    return tool;
  };

  const mockTools: ChatCompletionTool[] = [
    {
      type: "function",
      function: { name: "read_file", description: "Read a file" },
    },
    {
      type: "function",
      function: { name: "write_file", description: "Write a file" },
    },
  ];

  it("returns tools unchanged when no overrides", () => {
    expect(applyChatCompletionToolOverrides(mockTools, undefined)).toEqual(
      mockTools,
    );
    expect(applyChatCompletionToolOverrides(mockTools, {})).toEqual(mockTools);
  });

  it("applies description override", () => {
    const result = applyChatCompletionToolOverrides(mockTools, {
      read_file: { description: "Custom read description" },
    });
    expect(functionTool(result[0]).function.description).toBe(
      "Custom read description",
    );
    expect(functionTool(result[1]).function.description).toBe("Write a file");
  });

  it("filters out disabled tools", () => {
    const result = applyChatCompletionToolOverrides(mockTools, {
      read_file: { disabled: true },
    });
    expect(result).toHaveLength(1);
    expect(functionTool(result[0]).function.name).toBe("write_file");
  });

  it("handles multiple overrides", () => {
    const result = applyChatCompletionToolOverrides(mockTools, {
      read_file: { description: "Custom read" },
      write_file: { description: "Custom write" },
    });
    expect(functionTool(result[0]).function.description).toBe("Custom read");
    expect(functionTool(result[1]).function.description).toBe("Custom write");
  });

  it("ignores overrides for non-existent tools", () => {
    const result = applyChatCompletionToolOverrides(mockTools, {
      non_existent_tool: { description: "Should be ignored" },
    });
    expect(result).toEqual(mockTools);
  });

  it("does not mutate original tools", () => {
    const originalDescription = functionTool(mockTools[0]).function.description;
    applyChatCompletionToolOverrides(mockTools, {
      read_file: { description: "Modified description" },
    });
    expect(functionTool(mockTools[0]).function.description).toBe(
      originalDescription,
    );
  });
});

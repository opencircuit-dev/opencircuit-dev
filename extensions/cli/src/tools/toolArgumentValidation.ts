import type { Tool, ToolCall } from "./types.js";

/** Only missing required top-level fields qualify for argument recovery. */
export class MissingToolArgumentsError extends Error {
  constructor(
    readonly toolName: string,
    readonly fields: string[],
  ) {
    super(`Required parameter "${fields[0]}" missing for tool "${toolName}"`);
  }
}

export function validateToolCallArgsPresent(toolCall: ToolCall, tool: Tool) {
  const args = toolCall.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`Arguments for tool "${toolCall.name}" must be an object`);
  }
  const missing = (tool.parameters.required ?? []).filter(
    (field) =>
      !Object.hasOwn(args, field) ||
      args[field] === undefined ||
      args[field] === null,
  );
  if (missing.length)
    throw new MissingToolArgumentsError(toolCall.name, missing);
}

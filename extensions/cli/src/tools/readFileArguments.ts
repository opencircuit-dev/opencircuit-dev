import { readFileTool } from "./readFile.js";
import type { Tool, ToolCall } from "./types.js";

/**
 * Retained failed-call evidence proves a single Read.file_path string is the
 * supplied target, under the wrong key. Preserve that exact value; do not infer
 * other aliases, choose among fields, or change the requested file.
 */
export function normalizeReadFileArgs(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const args = value as Record<string, unknown>;
  if (
    Object.keys(args).length === 1 &&
    Object.hasOwn(args, "file_path") &&
    typeof args.file_path === "string" &&
    args.file_path.trim().length > 0
  ) {
    return { filepath: args.file_path };
  }
  return args;
}

/** Normalize only the known built-in Read, before ordinary validation/policy. */
export function normalizeReadFileCall(call: ToolCall, tool: Tool): ToolCall {
  if (tool !== readFileTool || call.name !== "Read") return call;
  const args = normalizeReadFileArgs(call.arguments);
  if (!args || args === call.arguments) return call;
  return { ...call, arguments: args, argumentsStr: JSON.stringify(args) };
}

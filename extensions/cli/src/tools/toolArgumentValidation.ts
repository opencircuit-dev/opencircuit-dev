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

/** Explain the actual key mismatch without echoing file contents or guessing. */
export function formatMissingArgumentsFeedback(
  error: MissingToolArgumentsError,
  call: ToolCall,
  schema: unknown,
): string {
  const keys =
    call.arguments && typeof call.arguments === "object"
      ? Object.keys(call.arguments)
      : [];
  return [
    error.message,
    `Missing fields: ${error.fields.join(", ")}.`,
    `Received argument keys: ${keys.length ? keys.join(", ") : "(none)"}.`,
    `Advertised tool schema: ${JSON.stringify(schema)}`,
    call.name === "Read"
      ? 'For Read, use a JSON object with the exact key "filepath", for example {"filepath":"<exact supplied file path>"}. Preserve the target path; do not guess or change it.'
      : "",
    "You may make at most one correction as a single new call to this tool, within existing turn and policy limits. Supply all required fields.",
    call.name === "Write"
      ? "For Write, use only a destination explicitly named by the user or established by a successful prior Read; ask for clarification if unknown."
      : "",
    "Do not guess, replay successful calls, or retry a denial.",
  ]
    .filter(Boolean)
    .join("\n");
}

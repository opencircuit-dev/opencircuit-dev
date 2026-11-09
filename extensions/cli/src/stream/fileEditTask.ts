import * as path from "node:path";

import type { ChatHistoryItem } from "core/index.js";
import { stripImages } from "core/messageContent.js";

import type { ToolCall } from "../tools/types.js";

import type { TurnGuard } from "./turnGuard.js";

/** Deliberately narrow: a direct single-file edit request, not a general coding task. */
export function explicitFileTarget(
  text: string,
  cwd = process.cwd(),
): string | undefined {
  const match = text
    .trim()
    .match(
      /^(?:please\s+)?(?:now\s+)?(?:update|edit|modify|patch|overwrite|write(?:\s+to)?)\s+(?:(?:the\s+)?file\s+(?:at\s+)?)?(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|([^\s`"'<>]+?))(?=\s|$)(?:\s+(?:to|with)\s+[\s\S]+)?\s*$/i,
    );
  const value = match && (match[1] ?? match[2] ?? match[3] ?? match[4]);
  if (
    !value ||
    value.includes("\0") ||
    value.includes("://") ||
    /[/\\]$/.test(value) ||
    !/[/\\]|\.[\w-]+$/.test(value)
  )
    return;
  return path.resolve(cwd, value);
}

export class FileEditTask {
  readonly target?: string;
  stopNotice?: string;
  private readonly cwd = process.cwd();

  constructor(history: ChatHistoryItem[]) {
    const user = history.findLast((item) => item.message.role === "user");
    this.target = explicitFileTarget(
      user ? stripImages(user.message.content) : "",
      this.cwd,
    );
  }

  inspect(calls: ToolCall[]): string | undefined {
    if (this.stopNotice) return this.stopNotice;
    if (!this.target) return;
    for (const call of calls) {
      if (call.name === "Bash") {
        this.stopNotice =
          "Stopped: Bash is unavailable for a direct single-file edit. Use Read followed by Edit or Write with the exact user-specified path. No tools in this batch executed. No further tools will run this turn.";
        return this.stopNotice;
      }
      const value =
        call.name === "Write"
          ? call.arguments?.filepath
          : ["Edit", "MultiEdit"].includes(call.name)
            ? call.arguments?.file_path
            : undefined;
      // Missing/type-invalid parameters still use ordinary schema validation.
      if (typeof value !== "string" || !value.trim()) continue;
      if (
        value.includes("\0") ||
        path.resolve(this.cwd, value) !== this.target
      ) {
        this.stopNotice =
          "Stopped: the tool destination differs from the user's explicit file. No tools in this batch executed. Do not guess or substitute another path; clarify the destination with the user. No further tools will run this turn.";
        return this.stopNotice;
      }
    }
  }
}

const tasks = new WeakMap<object, FileEditTask>();
export function getFileEditTask(
  guard: TurnGuard | undefined,
  history: ChatHistoryItem[],
): FileEditTask {
  const key =
    guard ??
    history.findLast((item) => item.message.role === "user") ??
    history;
  let task = tasks.get(key);
  if (!task) {
    task = new FileEditTask(history);
    tasks.set(key, task);
  }
  return task;
}

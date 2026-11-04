import * as path from "node:path";

import type { ChatHistoryItem } from "core/index.js";
import { stripImages } from "core/messageContent.js";

import { normalizeReadFileArgs } from "../tools/readFileArguments.js";
import type { ToolCall } from "../tools/types.js";

import type { TurnGuard } from "./turnGuard.js";

export interface MissingArguments {
  toolCallId: string;
  toolName: string;
  fields: string[];
}

const CLARIFY =
  "Stopped: the Write destination is unknown or ambiguous. Please clarify which file to write. No correction was executed.";
const EXHAUSTED =
  "Stopped: argument recovery exhausted. The correction failed or was not a single call to the expected tool. No further tools will run this turn.";

/** Runtime evidence, never model assurances or the mere existence of a file. */
export class ArgumentRecovery {
  private readonly paths = new Set<string>();
  private readonly used = new Set<string>();
  private readonly cwd = process.cwd();
  pendingTool?: string;
  stopNotice?: string;

  constructor(history: ChatHistoryItem[]) {
    const user = history.findLast((item) => item.message.role === "user");
    const text = user ? stripImages(user.message.content) : "";
    // Quoted destinations may contain spaces. Bare destinations must look like
    // paths; ordinary prose words cannot establish a file destination.
    for (const match of (text ?? "").matchAll(
      /`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|([^\s`"'<>()[\]{},;!?]+)/g,
    )) {
      const quoted = match[1] ?? match[2] ?? match[3];
      const token = quoted ?? match[4].replace(/[.:]+$/, "");
      const explicitDestination =
        /(?:to|file|path|destination|named|called|at)\s*[:=]?\s*$/i.test(
          (text ?? "").slice(0, match.index),
        );
      if (/[/\\]|\.[\w-]+$/.test(token) || (quoted && explicitDestination))
        this.addPath(token);
    }
    this.captureContext(history);
  }

  captureContext(history: ChatHistoryItem[]): void {
    if (this.pendingTool || this.stopNotice) return;
    // Capture established context before recovery, including successful reads
    // from earlier turns. Assistant prose and tool output text are not evidence.
    for (const item of history) {
      for (const state of item.toolCallStates ?? []) {
        if (
          state.status === "done" &&
          state.toolCall.function.name === "Read"
        ) {
          this.addPath(normalizeReadFileArgs(state.parsedArgs)?.filepath);
        }
      }
    }
  }

  private addPath(value: unknown) {
    if (
      typeof value === "string" &&
      value.trim() &&
      !value.includes("\0") &&
      !value.includes("://")
    ) {
      this.paths.add(path.resolve(this.cwd, value));
    }
  }

  private grounded(value: unknown): boolean {
    return (
      typeof value === "string" &&
      !!value.trim() &&
      this.paths.has(path.resolve(this.cwd, value))
    );
  }

  inspect(calls: ToolCall[]): string | undefined {
    if (this.stopNotice) return this.stopNotice;
    if (!this.pendingTool) return;
    if (calls.length !== 1 || calls[0].name !== this.pendingTool)
      return this.stop(EXHAUSTED);
    const call = calls[0];
    if (
      call.name === "Write" &&
      call.arguments?.filepath !== undefined &&
      call.arguments?.filepath !== null &&
      !this.grounded(call.arguments.filepath)
    ) {
      return this.stop(CLARIFY);
    }
  }

  begin(errors: MissingArguments[], calls: ToolCall[]): string | undefined {
    if (!errors.length) return;
    if (
      this.pendingTool ||
      errors.length !== 1 ||
      calls.length !== 1 ||
      this.used.has(errors[0].toolName)
    ) {
      return this.stop(EXHAUSTED);
    }
    const call = calls[0];
    if (call.name === "Write") {
      const destination = call.arguments?.filepath;
      const missingDestination =
        destination === undefined || destination === null;
      const canGround = missingDestination
        ? this.paths.size === 1
        : this.grounded(destination);
      if (!canGround) return this.stop(CLARIFY);
    }
    this.used.add(call.name);
    this.pendingTool = call.name;
  }

  finish(failed: boolean): string | undefined {
    if (failed) return this.stop(EXHAUSTED);
    this.pendingTool = undefined;
  }

  private stop(notice: string): string {
    this.stopNotice = notice;
    return notice;
  }
}

// A guard is created per user turn and inherited by compaction sub-turns. Its
// recovery state has the same lifetime, independently of model call IDs/args.
const states = new WeakMap<TurnGuard, ArgumentRecovery>();
export function getArgumentRecovery(
  guard: TurnGuard | undefined,
  history: ChatHistoryItem[],
): ArgumentRecovery {
  if (!guard) return new ArgumentRecovery(history);
  let state = states.get(guard);
  if (!state) {
    state = new ArgumentRecovery(history);
    states.set(guard, state);
  }
  return state;
}

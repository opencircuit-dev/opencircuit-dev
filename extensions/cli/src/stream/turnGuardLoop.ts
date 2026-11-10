import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { services } from "../services/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { logger } from "../util/logger.js";

import type { StreamCallbacks } from "./streamChatResponse.types.js";
import {
  createTurnGuard,
  resolveLimits,
  type Breach,
  type TurnGuard,
} from "./turnGuard.js";
import { getSessionOverride, readOrgPolicy } from "./turnGuardPolicy.js";

// Holder created per user turn. Compaction sub-turns started inside that turn
// reuse its guard so every provider request shares one per-turn budget.
const turnScope = new AsyncLocalStorage<{ guard?: TurnGuard }>();

export function emitTurnGuardTelemetry(guard: TurnGuard): void {
  const c = guard.counters;
  for (const [reason, n] of Object.entries(c.breach)) {
    telemetryService.recordTurnGuardEvent(
      "turn_guard_breach_total",
      n ?? 0,
      reason,
    );
  }
  telemetryService.recordTurnGuardEvent(
    "turn_guard_invalid_call_id_total",
    c.invalid_call_id,
  );
  telemetryService.recordTurnGuardEvent(
    "turn_guard_unknown_tool_total",
    c.unknown_tool,
  );
  telemetryService.recordTurnGuardEvent(
    "turn_guard_duplicate_record_total",
    c.duplicate_record,
  );
  telemetryService.recordTurnGuardEvent(
    "turn_guard_stale_reservation_total",
    c.stale_reservation,
  );
  telemetryService.recordTurnGuardEvent(
    "turn_guard_late_result_discarded_total",
    c.late_result_discarded,
  );
}

export async function withTurnScope<T>(fn: () => Promise<T>): Promise<T> {
  const holder: { guard?: TurnGuard } = {};
  try {
    return await turnScope.run(holder, fn);
  } finally {
    if (holder.guard) emitTurnGuardTelemetry(holder.guard);
  }
}

const ENV_LIMITS: Record<string, string> = {
  OC_TURN_MAX_CALLS: "maxCalls",
  OC_TURN_MAX_IDENTICAL_FAILURES: "maxIdenticalFailures",
  OC_TURN_MAX_DENIALS: "maxDenialsPerClass",
  OC_TURN_MAX_COMPACTIONS: "maxCompactions",
  OC_TURN_MAX_WALL_CLOCK_MS: "maxWallClockMs",
};

// Environment may only lower limits; invalid values are ignored and logged
// (resolveLimits never lets a bad value disable a control).
// User config: ~/.ocircuit/turn-guard.json with the same keys as TurnLimits.
// A missing file is normal; unreadable or malformed files are ignored and logged
// (defaults stay in force, nothing is disabled). Organization policy and session
// overrides come from turnGuardPolicy.ts.
function configLimits(): Record<string, unknown> {
  const file = path.join(os.homedir(), ".ocircuit", "turn-guard.json");
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { __invalid__: parsed };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("Turn guard: ignoring unreadable turn-guard.json");
    }
    return {};
  }
}

function envLimits(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, key] of Object.entries(ENV_LIMITS)) {
    const raw = process.env[name];
    if (raw !== undefined) out[key] = /^\d+$/.test(raw) ? Number(raw) : NaN;
  }
  return out;
}

export function formatBreachNotice(
  breach: Breach,
  counters: TurnGuard["counters"],
  snapshot: ReturnType<TurnGuard["snapshot"]>,
): string {
  const ids = (breach.evidence.topSignatureIds as string[] | undefined)?.join(
    ", ",
  );
  return [
    `Stopped: turn guard tripped (${breach.reason}). Tool use was halted to prevent a runaway loop.`,
    `Tool calls this turn: ${snapshot.consumedCalls}; compactions: ${snapshot.compactions}; elapsed: ${Math.round(snapshot.elapsedMs / 1000)}s.`,
    `Rejected unknown tools: ${counters.unknown_tool}; invalid call IDs: ${counters.invalid_call_id}.`,
    ids ? `Repeated-failure IDs (opaque, per turn): ${ids}.` : "",
    "Next: review the last tool results, fix the cause or change the approach, then tell me how to proceed.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Glue between the pure turn guard and the streaming loop. Every protection is
// always enforced. OC_TURN_GUARD accepts only "enforce"; the transitional
// "rewrite-observe" mode was removed because the v1 rewrite pipeline it would
// observe is not implemented, so any other value is warned about and ignored.
export function createLoopGuard(
  isCompacting: boolean,
  isHeadless: boolean,
  abortController?: AbortController,
) {
  const orgPolicy = readOrgPolicy();
  if (orgPolicy.rejected) {
    logger.warn("Turn guard: ignoring organization policy", {
      reason: orgPolicy.rejected,
    });
  }
  const { limits, invalid } = resolveLimits({
    interactive: !isHeadless,
    org: orgPolicy.limits,
    session: getSessionOverride(),
    config: configLimits(),
    env: envLimits(),
  });
  const mode = process.env.OC_TURN_GUARD;
  if (mode !== undefined && mode !== "enforce") {
    // Fail closed: an unknown mode never relaxes anything.
    logger.warn("Turn guard: invalid OC_TURN_GUARD; using enforce");
  }
  if (invalid.length) {
    logger.warn("Turn guard: ignored invalid limit settings", { invalid });
    telemetryService.recordTurnGuardEvent(
      "turn_guard_config_invalid_total",
      invalid.length,
    );
  }
  const scope = turnScope.getStore();
  const inherited = isCompacting ? scope?.guard : undefined;
  const guard = inherited ?? createTurnGuard({ limits });
  if (!isCompacting && scope) scope.guard = guard;

  // The loop check alone cannot stop an in-flight provider request. Abort the
  // active turn at the same deadline so the existing provider cancellation path
  // can return control to the guard and emit its wall-clock breach notice.
  const ownsTimer = !inherited && abortController !== undefined;
  const deadlineTimer = ownsTimer
    ? setTimeout(() => {
        const verdict = guard.check();
        if (
          !verdict.ok &&
          verdict.breach.reason === "wall_clock" &&
          !abortController.signal.aborted
        ) {
          logger.warn("Turn guard wall-clock limit reached; aborting turn");
          abortController.abort();
        }
      }, guard.limits.maxWallClockMs)
    : undefined;
  deadlineTimer?.unref?.();

  return {
    enforced: guard,

    dispose() {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    },

    noteCompaction() {
      guard.noteCompaction();
    },

    registerRegistry(toolNames: string[]): number {
      return guard.registerRegistry(toolNames);
    },

    // Returns the stop notice when the turn must end, otherwise undefined.
    stopIfBreached(
      isHeadlessRun: boolean,
      callbacks?: StreamCallbacks,
    ): string | undefined {
      const verdict = guard.check();
      if (verdict.ok) return undefined;
      const notice = formatBreachNotice(
        verdict.breach,
        guard.counters,
        guard.snapshot(),
      );
      logger.warn("Turn guard breach", {
        reason: verdict.breach.reason,
        counters: guard.counters,
      });
      if (services.chatHistory?.isReady?.()) {
        services.chatHistory.addAssistantMessage(notice);
      }
      callbacks?.onContent?.(notice);
      if (isHeadlessRun) process.exitCode = 2;
      return notice;
    },
  };
}

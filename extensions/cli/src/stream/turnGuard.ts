import { createHmac, randomBytes } from "node:crypto";

// Per-user-turn guard against runaway autonomous loops. Pure logic: no I/O and no
// dependency on the model.

export interface TurnLimits {
  maxCalls: number;
  maxIdenticalFailures: number;
  maxDenialsPerClass: number;
  maxCompactions: number;
  maxWallClockMs: number;
}

export const DEFAULT_LIMITS: Readonly<TurnLimits> = Object.freeze({
  maxCalls: 100,
  maxIdenticalFailures: 5,
  maxDenialsPerClass: 2,
  maxCompactions: 3,
  maxWallClockMs: 30 * 60_000,
});

// No configuration, environment variable or session override can exceed these.
export const HARD_CEILINGS: Readonly<TurnLimits> = Object.freeze({
  maxCalls: 500,
  maxIdenticalFailures: 10,
  maxDenialsPerClass: 5,
  maxCompactions: 10,
  maxWallClockMs: 120 * 60_000,
});

export const ACTION_CLASSES = [
  "read",
  "write",
  "shell",
  "network",
  "search",
  "subagent",
  "mcp",
  "other",
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

const TOOL_CLASS: Record<string, ActionClass> = {
  Read: "read",
  List: "read",
  Diff: "read",
  Write: "write",
  Edit: "write",
  MultiEdit: "write",
  Bash: "shell",
  CheckBackgroundJob: "shell",
  Fetch: "network",
  Search: "search",
  Subagent: "subagent",
};

export function actionClassForTool(
  name: string,
  mcpToolNames?: ReadonlySet<string>,
): ActionClass {
  const known = Object.prototype.hasOwnProperty.call(TOOL_CLASS, name)
    ? TOOL_CLASS[name]
    : undefined;
  if (known) return known;
  if (name.startsWith("mcp__") || mcpToolNames?.has(name)) return "mcp";
  return "other";
}

type LimitKey = keyof TurnLimits;
const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS) as LimitKey[];
type LimitInput = Partial<Record<string, unknown>>;

export interface ResolveInput {
  config?: LimitInput;
  org?: LimitInput;
  session?: LimitInput;
  env?: LimitInput;
  interactive?: boolean;
}

function validLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

// Precedence (highest first): hard ceiling (clamp) -> organization policy ->
// session override (interactive only, capped by org) -> config -> default.
// Environment variables apply last and may only lower the result. An invalid
// value (zero, negative, non-integer, non-finite, unknown key) never disables a
// control: it is ignored, the lower-precedence value is kept, and it is reported.
export function resolveLimits(input: ResolveInput): {
  limits: TurnLimits;
  invalid: string[];
} {
  const invalid = new Set<string>();
  const sources: [string, LimitInput | undefined][] = [
    ["config", input.config],
    ["org", input.org],
    ["session", input.session],
    ["env", input.env],
  ];
  for (const [, src] of sources) {
    for (const [key, value] of Object.entries(src ?? {})) {
      if (!LIMIT_KEYS.includes(key as LimitKey) || !validLimit(value)) {
        invalid.add(key);
      }
    }
  }
  const pick = (src: LimitInput | undefined, key: LimitKey) =>
    validLimit(src?.[key]) ? (src![key] as number) : undefined;

  const limits = {} as TurnLimits;
  for (const key of LIMIT_KEYS) {
    const hard = HARD_CEILINGS[key];
    const org = pick(input.org, key);
    let value = pick(input.config, key) ?? DEFAULT_LIMITS[key];
    if (org !== undefined) value = org;
    const session = pick(input.session, key);
    if (input.interactive && session !== undefined) {
      value = Math.min(session, org ?? hard);
    }
    const env = pick(input.env, key);
    if (env !== undefined) value = Math.min(value, env);
    limits[key] = Math.min(value, hard);
  }
  return { limits, invalid: [...invalid] };
}

export type BreachReason =
  | "calls"
  | "identical_failure"
  | "denial"
  | "compaction"
  | "wall_clock";

export interface Breach {
  reason: BreachReason;
  evidence: Record<string, unknown>;
}

export type CheckResult = { ok: true } | { ok: false; breach: Breach };

export interface ProviderCall {
  id: string;
  name: string;
}

export interface Outcome {
  status: "done" | "errored" | "canceled";
  actionClass: ActionClass;
  // Stable caller-built identity of the failure (tool + error class + argument shape).
  signature: string;
}

export type ReserveResult =
  | {
      ok: true;
      reservation: {
        batchId: string;
        tokens: ReadonlyMap<string, string>;
        generation: number;
      };
    }
  | { ok: false; reason: "calls" | "invalid_call" | "unknown_tool" };

export type RecordResult =
  | "recorded"
  | "duplicate"
  | "unknown"
  | "stale"
  | "late";

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 128;
const MAX_SIGNATURES = 1024;
const OVERFLOW_SIGNATURE = "__overflow__";
// C0/C1 controls, Unicode format characters (bidi, zero-width), line/paragraph separators.
const FORBIDDEN_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function validProviderString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    Buffer.byteLength(value, "utf8") <= max &&
    !FORBIDDEN_CHARS.test(value) &&
    !LONE_SURROGATE.test(value) &&
    value === value.normalize("NFC")
  );
}

export interface TurnGuardOptions {
  limits?: TurnLimits;
  now?: () => number;
}

export function createTurnGuard(options: TurnGuardOptions = {}) {
  const limits = options.limits ?? { ...DEFAULT_LIMITS };
  const now = options.now ?? Date.now;
  const startedAt = now();
  const salt = randomBytes(16);
  const signatureId = (sig: string) =>
    createHmac("sha256", salt).update(sig).digest("hex").slice(0, 8);

  const registries = new Map<number, ReadonlySet<string>>();
  let generation = 0;
  let consumedCalls = 0;
  let compactions = 0;
  let breach: Breach | undefined;
  const tokens = new Map<string, { recorded: boolean; generation: number }>();
  const failures = new Map<string, number>();
  const denials = new Map<ActionClass, number>();

  const counters = {
    breach: {} as Partial<Record<BreachReason, number>>,
    invalid_call_id: 0,
    unknown_tool: 0,
    duplicate_record: 0,
    stale_reservation: 0,
    late_result_discarded: 0,
  };

  function trip(reason: BreachReason, evidence: Record<string, unknown>) {
    if (!breach) {
      breach = { reason, evidence };
      counters.breach[reason] = (counters.breach[reason] ?? 0) + 1;
    }
  }

  function topSignatureIds(): string[] {
    return [...failures.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);
  }

  return {
    counters,
    limits,

    // Freezes the names actually advertised to the model for one provider request.
    registerRegistry(toolNames: Iterable<string>): number {
      generation += 1;
      registries.set(generation, new Set(toolNames));
      for (const key of registries.keys()) {
        if (key < generation - 1) registries.delete(key);
      }
      return generation;
    },

    reserve(
      providerCalls: readonly ProviderCall[],
      registryGeneration: number,
    ): ReserveResult {
      const seen = new Set<string>();
      let valid = providerCalls.length > 0;
      for (const call of providerCalls) {
        if (
          !validProviderString(call?.id, MAX_ID_LENGTH) ||
          !validProviderString(call?.name, MAX_NAME_LENGTH) ||
          seen.has(call.id)
        ) {
          valid = false;
          break;
        }
        seen.add(call.id);
      }
      if (!valid) {
        counters.invalid_call_id += 1;
        return { ok: false, reason: "invalid_call" };
      }
      const registry = registries.get(registryGeneration);
      if (!registry || providerCalls.some((c) => !registry.has(c.name))) {
        counters.unknown_tool += 1;
        return { ok: false, reason: "unknown_tool" };
      }
      // Single invariant: consumedCalls + requestedBatchSize <= callCap.
      if (consumedCalls + providerCalls.length > limits.maxCalls) {
        trip("calls", {
          consumedCalls,
          requested: providerCalls.length,
          cap: limits.maxCalls,
        });
        return { ok: false, reason: "calls" };
      }
      consumedCalls += providerCalls.length;
      const minted = new Map<string, string>();
      for (const call of providerCalls) {
        const token = randomBytes(16).toString("hex");
        tokens.set(token, { recorded: false, generation: registryGeneration });
        minted.set(call.id, token);
      }
      return {
        ok: true,
        reservation: {
          batchId: randomBytes(16).toString("hex"),
          tokens: minted,
          generation: registryGeneration,
        },
      };
    },

    record(token: string, outcome: Outcome): RecordResult {
      const entry = tokens.get(token);
      if (!entry) {
        counters.stale_reservation += 1;
        return "unknown";
      }
      if (entry.generation !== generation) {
        counters.stale_reservation += 1;
        return "stale";
      }
      if (entry.recorded) {
        counters.duplicate_record += 1;
        return "duplicate";
      }
      entry.recorded = true;
      if (breach) {
        counters.late_result_discarded += 1;
        return "late";
      }
      if (outcome.status === "errored") {
        let id = signatureId(outcome.signature);
        if (!failures.has(id) && failures.size >= MAX_SIGNATURES) {
          id = signatureId(OVERFLOW_SIGNATURE);
        }
        const count = (failures.get(id) ?? 0) + 1;
        failures.set(id, count);
        if (count >= limits.maxIdenticalFailures) {
          trip("identical_failure", {
            count,
            cap: limits.maxIdenticalFailures,
            actionClass: outcome.actionClass,
            topSignatureIds: topSignatureIds(),
          });
        }
      } else if (outcome.status === "canceled") {
        const count = (denials.get(outcome.actionClass) ?? 0) + 1;
        denials.set(outcome.actionClass, count);
        if (count >= limits.maxDenialsPerClass) {
          trip("denial", {
            count,
            cap: limits.maxDenialsPerClass,
            actionClass: outcome.actionClass,
          });
        }
      }
      return "recorded";
    },

    noteCompaction() {
      compactions += 1;
      if (compactions >= limits.maxCompactions) {
        trip("compaction", { count: compactions, cap: limits.maxCompactions });
      }
    },

    check(): CheckResult {
      if (!breach && now() - startedAt >= limits.maxWallClockMs) {
        trip("wall_clock", {
          elapsedMs: now() - startedAt,
          cap: limits.maxWallClockMs,
        });
      }
      return breach ? { ok: false, breach } : { ok: true };
    },

    snapshot() {
      return {
        consumedCalls,
        compactions,
        identicalFailures: Math.max(0, ...failures.values()),
        signatureTableSize: failures.size,
        elapsedMs: now() - startedAt,
      };
    },
  };
}

export type TurnGuard = ReturnType<typeof createTurnGuard>;

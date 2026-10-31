import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import Ajv2020 from "ajv/dist/2020.js";

// Profile: JSON Schema 2020-12 (Ajv2020), local "#..." references only (no remote
// loading), at most MAX_SCHEMA_BYTES / MAX_WALK_NODES / depth 64. This is basic
// argument validation, not the full v1 validator contract (v1 recovery and
// keyword allow-listing remain deferred). Anything outside the profile, malformed
// schemas included, is rejected (fail closed).
//
// Tool-argument schema validation (v2 work item C, steps 6-7).
// Regex policy: any pattern RE2 compiles is accepted and evaluated only by RE2
// (linear time); a pattern RE2 rejects is rejected at registration. If no RE2
// engine loads, schemas that use pattern/patternProperties fail closed and never
// fall back to the JavaScript RegExp engine.

const require = createRequire(import.meta.url);

const MAX_ARGUMENT_BYTES = 1_000_000;
const MAX_SCHEMA_BYTES = 256 * 1024;

type Re2Ctor = new (
  pattern: string,
  flags?: string,
) => {
  test(s: string): boolean;
};

export interface RegexEngineInfo {
  name: "re2";
  version: string;
  ajv: string;
}

export type SchemaErrorCode =
  | "schema_invalid"
  | "schema_pattern_unsupported"
  | "regex_engine_unavailable";

export type CompileResult =
  | {
      ok: true;
      validate: (args: unknown) => boolean;
      errors: () => unknown[];
      digest: string;
      engine: RegexEngineInfo;
    }
  | { ok: false; code: SchemaErrorCode };

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "invalid_arguments" | "arguments_too_large";
      detail?: string;
    };

// Reads package metadata only; this never loads the native RE2 binding, so schemas
// without patterns still compile when the binding is unavailable.
export function regexEngineInfo(): RegexEngineInfo {
  const version = (pkg: string) => {
    try {
      return require(`${pkg}/package.json`).version as string;
    } catch {
      return "unknown";
    }
  };
  return { name: "re2", version: version("re2"), ajv: version("ajv") };
}

function defaultLoadRe2(): Re2Ctor {
  return require("re2") as Re2Ctor;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const DATA_KEYWORDS = new Set(["enum", "const", "default", "examples"]);
const MAX_WALK_NODES = 50_000;

// Collects every `pattern` and `patternProperties` key so unsupported patterns are
// rejected at registration even inside subschemas AJV would never compile.
function collectPatterns(schema: unknown): string[] | undefined {
  const found: string[] = [];
  let nodes = 0;
  const walk = (node: unknown, depth: number): boolean => {
    if (!node || typeof node !== "object") return true;
    if (depth > 64 || ++nodes > MAX_WALK_NODES) return false;
    if (Array.isArray(node)) return node.every((n) => walk(n, depth + 1));
    for (const [key, value] of Object.entries(node)) {
      if (DATA_KEYWORDS.has(key)) continue;
      if (
        (key === "$ref" || key === "$dynamicRef") &&
        (typeof value !== "string" || !value.startsWith("#"))
      ) {
        return false;
      }
      if (key === "pattern" && typeof value === "string") found.push(value);
      if (key === "patternProperties" && value && typeof value === "object") {
        found.push(...Object.keys(value));
      }
      if (!walk(value, depth + 1)) return false;
    }
    return true;
  };
  return walk(schema, 0) ? found : undefined;
}

class EngineUnavailable extends Error {}
class PatternUnsupported extends Error {}

export function compileToolSchema(
  schema: unknown,
  options: { loadRe2?: () => Re2Ctor } = {},
): CompileResult {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { ok: false, code: "schema_invalid" };
  }
  const loadRe2 = options.loadRe2 ?? defaultLoadRe2;
  let RE2: Re2Ctor | undefined;

  // AJV calls this for both `pattern` and `patternProperties`. It is only invoked
  // when a schema actually contains a pattern.
  let toolPatterns = new Set<string>();
  const regExp = (pattern: string, flags?: string) => {
    // Ajv's own meta-schema patterns are fixed, trusted strings and may use the
    // native engine; every tool-supplied pattern is RE2-only.
    if (!toolPatterns.has(pattern)) return new RegExp(pattern, flags);
    if (!RE2) {
      try {
        RE2 = loadRe2();
      } catch {
        throw new EngineUnavailable();
      }
    }
    try {
      return new RE2(pattern, flags);
    } catch {
      throw new PatternUnsupported();
    }
  };

  try {
    if (Buffer.byteLength(JSON.stringify(schema), "utf8") > MAX_SCHEMA_BYTES) {
      return { ok: false, code: "schema_invalid" };
    }
    const patterns = collectPatterns(schema);
    if (!patterns) return { ok: false, code: "schema_invalid" };
    toolPatterns = new Set(patterns);
    for (const pattern of patterns) regExp(pattern, "u");
    const ajv = new Ajv2020({
      strict: false,
      allErrors: false,
      code: { regExp: regExp as never },
    });
    // Tool schemas often declare an older $schema; they are validated under the
    // 2020-12 profile regardless, and the original schema stays in the digest.
    const { $schema: _declared, ...body } = schema as Record<string, unknown>;
    const validate = ajv.compile(body);
    const engine = regexEngineInfo();
    const digest = createHash("sha256")
      .update(canonical({ schema, engine }))
      .digest("hex");
    return {
      ok: true,
      validate: (args) => validate(args) as boolean,
      errors: () => (validate.errors ?? []) as unknown[],
      digest,
      engine,
    };
  } catch (e) {
    if (e instanceof EngineUnavailable) {
      return { ok: false, code: "regex_engine_unavailable" };
    }
    if (e instanceof PatternUnsupported) {
      return { ok: false, code: "schema_pattern_unsupported" };
    }
    return { ok: false, code: "schema_invalid" };
  }
}

export function validateArgs(
  compiled: Extract<CompileResult, { ok: true }>,
  args: unknown,
): ValidationResult {
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(args) ?? "", "utf8");
  } catch {
    return { ok: false, code: "invalid_arguments", detail: "not serializable" };
  }
  if (size > MAX_ARGUMENT_BYTES) {
    return { ok: false, code: "arguments_too_large" };
  }
  if (compiled.validate(args)) return { ok: true };
  const first = compiled.errors()[0] as
    | { instancePath?: string; keyword?: string }
    | undefined;
  // Report only the location and keyword, never the offending value.
  return {
    ok: false,
    code: "invalid_arguments",
    detail: first
      ? `${first.instancePath || "/"} failed '${first.keyword}'`
      : undefined,
  };
}

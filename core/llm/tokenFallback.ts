// Shared fallback for token counting. A tokenizer failure (for example a
// special-token literal in user content) must never abort a turn: counting
// falls back to an upper bound.
//
// Adapter contract (see proposals/pro-harness-optimization_v2.md section 4):
//  - js-tiktoken (Core, gpt-4 / cl100k): positional encode(text, "all", []).
//    Every BPE token covers at least one UTF-8 byte, so UTF-8 byte length is an
//    upper bound on the raw token count. Framing overhead is added by callers.
//  - gpt-tokenizer (CLI): encode(text, { allowedSpecial: "all",
//    disallowedSpecial: new Set() }); same byte bound.
//  - Llama tokenizer: no options; encoding is byte-fallback, one token per byte
//    at worst, so the same bound holds.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAX_ENTRIES = 64;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 300;
const TTL_MS = 10 * 60_000;
const seen = new Map<string, number>();

export function utf8UpperBound(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// Appends one sanitized line to a private log, rotating to "<file>.1" once the
// file would exceed maxBytes, so total disk use stays below 2 * maxBytes. Never throws.
export function appendCappedLog(
  file: string,
  message: string,
  maxBytes: number = MAX_LOG_BYTES,
): void {
  try {
    const body =
      // eslint-disable-next-line no-control-regex
      message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_LINE_CHARS) +
      "\n";
    const line = `${new Date().toISOString()} ${body}`;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      // first write
    }
    if (size + Buffer.byteLength(line) > maxBytes) {
      fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, line, {
      mode: 0o600,
    });
  } catch {
    // logging must never break token counting
  }
}

const defaultLogFile = () =>
  path.join(os.homedir(), ".ocircuit", "logs", "token-fallback.log");

// Logs a message at most once per TTL, remembering at most MAX_ENTRIES messages.
export function warnOnceBounded(
  message: string,
  sink: (message: string) => void = (m) => appendCappedLog(defaultLogFile(), m),
): void {
  // Normalize and truncate so variable text cannot create unbounded distinct keys.
  const key = message.replace(/\d+/g, "#").slice(0, 160);
  const now = Date.now();
  const at = seen.get(key);
  if (at !== undefined && now - at < TTL_MS) return;
  seen.delete(key);
  if (seen.size >= MAX_ENTRIES) {
    const oldest = seen.keys().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  seen.set(key, now);
  sink(message);
}

export function encodeLengthOrBound(
  encode: (text: string) => ArrayLike<unknown>,
  text: string,
): number {
  try {
    return encode(text).length;
  } catch (e) {
    warnOnceBounded(
      `Token counting fell back to an upper-bound estimate: ${
        e instanceof Error ? e.message.slice(0, 120) : "unknown error"
      }`,
    );
    return utf8UpperBound(text);
  }
}

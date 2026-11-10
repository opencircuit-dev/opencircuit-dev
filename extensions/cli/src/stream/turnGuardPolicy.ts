import * as fs from "node:fs";

// Organization policy and interactive session overrides for the turn guard.
// Organization policy is an admin-owned JSON file with the same keys as
// TurnLimits. It is trusted only if it is a regular file owned by root or the
// current user and is not group/world writable; anything else is ignored (the
// defaults stay in force, so nothing is relaxed).
export const ORG_POLICY_PATHS: readonly string[] =
  process.platform === "darwin"
    ? ["/Library/Application Support/OpenCircuit/turn-guard.json"]
    : ["/etc/ocircuit/turn-guard.json"];

const MAX_POLICY_BYTES = 16 * 1024;

export interface PolicyResult {
  limits: Record<string, unknown>;
  rejected?: string;
}

export function readOrgPolicy(
  paths: readonly string[] = ORG_POLICY_PATHS,
  uid: number | undefined = process.getuid?.(),
): PolicyResult {
  for (const file of paths) {
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return { limits: {}, rejected: "not_regular_file" };
      if ((st.mode & 0o022) !== 0) {
        return { limits: {}, rejected: "writable_by_others" };
      }
      if (st.uid !== 0 && st.uid !== uid) {
        return { limits: {}, rejected: "untrusted_owner" };
      }
      if (st.size > MAX_POLICY_BYTES) {
        return { limits: {}, rejected: "too_large" };
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { limits: {}, rejected: "malformed" };
      }
      return { limits: parsed as Record<string, unknown> };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        return { limits: {}, rejected: "unreadable" };
      }
    }
  }
  return { limits: {} };
}

// In-memory only: set by an interactive user action, never persisted, and applied
// by resolveLimits only when the session is interactive (capped by org/hard ceiling).
let sessionOverride: Record<string, unknown> = {};

export function setSessionOverride(limits: Record<string, unknown>): void {
  sessionOverride = { ...limits };
}

export function getSessionOverride(): Record<string, unknown> {
  return sessionOverride;
}

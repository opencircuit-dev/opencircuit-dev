/**
 * Version Registry — Maps action types and features to protocol versions.
 *
 * @module version/registry
 */
import type { StateAction } from "../actions.js";
import type { ServerNotificationMap } from "../messages.js";
/**
 * The current protocol version that new code speaks.
 *
 * Formatted as a [SemVer](https://semver.org) `MAJOR.MINOR.PATCH` string.
 */
export declare const PROTOCOL_VERSION = "1.1.0";
/**
 * Every protocol version a client built from this source tree is willing
 * to negotiate via the `initialize` handshake. Ordered **most preferred
 * first** so a server picking the first acceptable entry honors the
 * client's preference (see [versioning](../../docs/specification/versioning.md)).
 *
 * These are released compatibility baselines, independent of the current
 * development {@link PROTOCOL_VERSION}. Hosts accept client-offered versions
 * in the caret-compatible range of either baseline.
 *
 * Every generated client (Rust, Kotlin, Swift) re-exports this constant
 * verbatim. The TypeScript client consumes it directly. The per-client
 * `release-metadata.json` files are validated against this list by
 * `scripts/verify-release-metadata.ts`.
 */
export declare const SUPPORTED_PROTOCOL_VERSIONS: readonly string[];
/**
 * Selects the highest client-offered version in a supported caret range.
 * Returns undefined when none match; the host must send UnsupportedProtocolVersion
 * with SUPPORTED_PROTOCOL_VERSIONS and close the connection. Malformed versions throw.
 */
export declare function negotiateProtocolVersion(
  offered: readonly string[],
): string | undefined;
/**
 * Compares two `MAJOR.MINOR.PATCH` SemVer strings.
 *
 * Returns a negative number if `a < b`, zero if `a === b`, and a positive
 * number if `a > b`.
 */
export declare function compareProtocolVersions(a: string, b: string): number;
/**
 * Maps every action type to the protocol version that introduced it.
 * Adding a new action to `StateAction` without adding it here is a compile error.
 *
 * Versions are SemVer `MAJOR.MINOR.PATCH` strings (see `PROTOCOL_VERSION`).
 */
export declare const ACTION_INTRODUCED_IN: {
  readonly [K in StateAction["type"]]: string;
};
/**
 * Returns whether the given action type is known to the specified protocol version.
 */
export declare function isActionKnownToVersion(
  action: StateAction,
  clientVersion: string,
): boolean;
/**
 * Server → client notification method names that are part of the AHP
 * protocol surface. The set is a subset of {@link ServerNotificationMap}
 * keys that excludes `action` (the action envelope) since action versions
 * are tracked via {@link ACTION_INTRODUCED_IN}.
 */
export type ProtocolNotificationMethod = Exclude<
  keyof ServerNotificationMap,
  "action"
>;
/**
 * Maps every server → client protocol notification method to the protocol
 * version that introduced it. Adding a new notification method to
 * {@link ServerNotificationMap} without adding it here is a compile error.
 *
 * Versions are SemVer `MAJOR.MINOR.PATCH` strings (see `PROTOCOL_VERSION`).
 */
export declare const NOTIFICATION_INTRODUCED_IN: {
  readonly [K in ProtocolNotificationMethod]: string;
};
/**
 * Returns whether the given notification method is known to the specified
 * protocol version.
 */
export declare function isNotificationKnownToVersion(
  method: ProtocolNotificationMethod,
  clientVersion: string,
): boolean;
//# sourceMappingURL=registry.d.ts.map

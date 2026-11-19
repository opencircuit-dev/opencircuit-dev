/**
 * Reconnect policy used by the per-host supervisor.
 *
 * Mirrors the Rust `ahp::hosts::ReconnectPolicy` surface.
 *
 * @module client/hosts/policy
 */
/**
 * Backoff schedule between reconnect attempts.
 *
 * Discriminated by the `kind` field so consumers can switch on the shape
 * and keep payload validation in one place.
 */
export type Backoff =
  | {
      readonly kind: "immediate";
    }
  | {
      readonly kind: "constant";
      readonly delayMs: number;
    }
  | {
      readonly kind: "exponential";
      /** First attempt's delay, in milliseconds. */
      readonly initialMs: number;
      /** Cap on per-attempt delay, in milliseconds. */
      readonly maxMs: number;
      /** Multiplier between attempts. Must be >= 1; smaller values are clamped. */
      readonly multiplier: number;
    };
/** Compute the delay before the `attempt`-th retry (1-based), in milliseconds. */
export declare function backoffDelayForAttempt(
  backoff: Backoff,
  attempt: number,
): number;
/**
 * Reconnect behaviour for a single host. The supervisor enters a
 * reconnect loop whenever an established connection drops unexpectedly.
 * Use {@link disabledPolicy} to opt out entirely.
 */
export interface ReconnectPolicy {
  /** Backoff schedule between attempts. */
  readonly backoff: Backoff;
  /**
   * Random jitter applied to each computed backoff. The actual delay
   * is uniformly sampled from `[delay * (1 - jitter), delay * (1 + jitter)]`.
   * `0` disables jitter. Values are clamped to `[0, 1]`.
   */
  readonly jitter: number;
  /**
   * Maximum number of consecutive attempts before giving up. `null`
   * retries forever. `0` disables reconnect entirely (one failure
   * leaves the host in `failed`).
   */
  readonly maxAttempts: number | null;
  /**
   * When `true`, the attempt counter resets to zero after a successful
   * connection so the next reconnect starts at the initial backoff.
   */
  readonly resetOnSuccess: boolean;
}
/**
 * Compute the delay before the `attempt`-th retry, applying jitter via
 * the supplied random sample in `[0, 1]`.
 *
 * Exposed so tests can drive it deterministically; the runtime passes a
 * real `Math.random()` sample.
 */
export declare function delayWithJitter(
  policy: ReconnectPolicy,
  attempt: number,
  sample: number,
): number;
/** Whether `attempt` exceeds the policy's `maxAttempts`. */
export declare function attemptsExhausted(
  policy: ReconnectPolicy,
  attempt: number,
): boolean;
/**
 * Disable reconnects entirely. Use this when the consumer wants to
 * drive reconnect logic itself.
 */
export declare function disabledPolicy(): ReconnectPolicy;
/** Retry forever with no backoff. Useful for tests; not production. */
export declare function immediateForeverPolicy(): ReconnectPolicy;
/**
 * Sensible default: exponential backoff from 250 ms up to 30 s,
 * 25% jitter, retry forever, reset on success.
 */
export declare function exponentialPolicy(): ReconnectPolicy;
/** Default policy used by {@link HostConfig} when none is supplied. */
export declare function defaultReconnectPolicy(): ReconnectPolicy;
//# sourceMappingURL=policy.d.ts.map

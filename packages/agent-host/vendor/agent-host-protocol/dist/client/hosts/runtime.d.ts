/**
 * Per-host supervisor.
 *
 * Owns the current {@link AhpClient}, the reconnect state machine, the
 * per-host root-state mirror, and the session-summary cache. Drives
 * inbound events out to the multi-host fan-in broadcasts.
 *
 * Unlike the Rust port, the supervisor doesn't use an mpsc command
 * channel. JavaScript's single-threaded execution model lets public
 * methods read shared state directly; coordination with the supervisor
 * loop uses {@link AbortController}s for cancel signals (analogous to
 * Rust's `tokio::Notify`).
 *
 * @module client/hosts/runtime
 */
import type { URI } from "../../types/common/state.js";
import type { SubscribeResult } from "../../types/common/commands.js";
import type { RootState } from "../../types/channels-root/state.js";
import type { SessionSummary } from "../../types/channels-session/state.js";
import { AhpClient, type DispatchHandle } from "../client.js";
import type { AsyncBroadcastQueue } from "../async-queue.js";
import type { StateAction } from "../../types/common/actions.js";
import type { AutomationCapabilities } from "../../types/common/commands.js";
import {
  type HostEvent,
  type HostHandle,
  type HostId,
  type HostState,
  type HostSubscriptionEvent,
  type ResolvedHostConfig,
} from "./types.js";
import type { HostClientHandleSource } from "./host-client-handle.js";
/**
 * Mutable per-host state read by the runtime, exposed read-only via
 * {@link snapshot} for {@link HostHandle}s and consumed by
 * {@link HostClientHandle}s through {@link HostClientHandleSource}.
 *
 * @internal
 */
export interface HostShared {
  readonly id: HostId;
  readonly label: string;
  clientId: string;
  state: HostState;
  lastError: Error | null;
  lastConnectedAt: number | null;
  protocolVersion: string | null;
  serverSeq: number;
  defaultDirectory: string | null;
  automations: AutomationCapabilities | null;
  rootState: RootState;
  subscriptions: URI[];
  completionTriggerCharacters: string[];
  sessionSummaries: Map<URI, SessionSummary>;
  generation: number;
  currentClient: AhpClient | null;
  /**
   * Set to `'removed'` by {@link MultiHostClient.removeHost} or
   * `'shutdown'` by a top-level shutdown. Held in the same shared
   * object as `generation` / `currentClient` so generation-checking
   * client handles can also detect a fully removed host.
   */
  shutdownReason: null | "removed" | "shutdown";
}
/** Build the initial shared state for a freshly registered host. @internal */
export declare function makeInitialShared(
  config: ResolvedHostConfig,
  resolvedClientId: string,
): HostShared;
/** Build an immutable {@link HostHandle} snapshot from shared state. @internal */
export declare function snapshotHandle(shared: HostShared): HostHandle;
/** Sentinel returned by {@link raceWithAbort} when the signal aborts first. */
export declare const ABORTED: unique symbol;
/**
 * Race a promise against an {@link AbortSignal}. Returns the original
 * promise value on completion, or {@link ABORTED} if the signal aborts
 * first.
 *
 * The inner promise is allowed to keep running; callers must not depend
 * on its side effects after a cancellation. A no-op rejection handler
 * is attached to the inner promise so a late rejection (e.g. an
 * in-flight `client.initialize` that surfaces `ClientClosedError`
 * after the client has been shut down) doesn't become an
 * `unhandledRejection`.
 *
 * @internal
 */
export declare function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof ABORTED>;
/**
 * Sleep `ms` milliseconds, returning early if any of the supplied
 * signals abort. Returns `true` if the sleep elapsed, `false` if any
 * signal aborted first.
 *
 * @internal
 */
export declare function sleepOrAbort(
  ms: number,
  ...signals: AbortSignal[]
): Promise<boolean>;
/**
 * Per-host supervisor.
 *
 * Construction sets up shared state and emits the `added` host event;
 * {@link HostRuntime.start} kicks off the connect/reconnect loop. The
 * loop runs until {@link HostRuntime.shutdown} aborts the shutdown
 * controller.
 *
 * @internal
 */
export declare class HostRuntime {
  private readonly config;
  readonly shared: HostShared;
  readonly handleSource: HostClientHandleSource;
  private readonly fanOut;
  private readonly hostEvents;
  private readonly shutdownController;
  private manualReconnectController;
  private supervisorPromise;
  /**
   * Resolved by {@link reconnect} when the manual-reconnect cycle has
   * actually been observed by the supervisor (state transitions to
   * `connecting` / `reconnecting`). Used so external callers see a
   * deterministic completion point.
   */
  private reconnectAck;
  constructor(
    config: ResolvedHostConfig,
    resolvedClientId: string,
    fanOut: AsyncBroadcastQueue<HostSubscriptionEvent>,
    hostEvents: AsyncBroadcastQueue<HostEvent>,
  );
  /** Start the supervisor. Emits the `added` host event before the first connect. */
  start(): void;
  /**
   * Request a manual reconnect. The current connection (or pending
   * backoff sleep) is interrupted and the supervisor immediately
   * attempts a fresh connect. Returns when the supervisor has
   * acknowledged the request (state has transitioned).
   */
  reconnect(): Promise<void>;
  /**
   * Tear down the supervisor. Marks the runtime as `removed`, aborts
   * the shutdown controller (which unblocks any in-flight
   * `connectOnce`, sleep, or read loop), and resolves once the
   * supervisor has exited.
   */
  shutdown(reason?: "removed" | "shutdown"): Promise<void>;
  /**
   * Subscribe to `uri`, tracking it for re-subscription across
   * reconnects.
   *
   * Throws {@link HostShutDownError} if the host has been permanently
   * torn down (removed or the multi-host client was shut down).
   *
   * Throws {@link HostNotConnectedError} if the host is registered but
   * has no active client connection right now (connecting, reconnecting,
   * disconnected, or failed). The URI is still appended to the local
   * subscription list first, so the next successful (re)connect will
   * subscribe to it automatically.
   */
  subscribe(uri: URI): Promise<SubscribeResult>;
  /**
   * Unsubscribe from `uri` and drop it from the local subscription
   * list. No-op if the host has been removed.
   */
  unsubscribe(uri: URI): Promise<void>;
  /**
   * Helper: dispatch on the current client (no generation check).
   *
   * Throws {@link HostShutDownError} if the host has been permanently
   * torn down, or {@link HostNotConnectedError} if it's currently
   * disconnected/reconnecting.
   */
  dispatch(
    channel: URI,
    action: StateAction,
    clientSeq?: number,
  ): DispatchHandle;
  private runSupervisor;
  /**
   * Open a transport, negotiate `initialize` or `reconnect`, refresh
   * caches, bump generation, install the client, and transition to
   * `connected`. Returns the connected client and an events iterator
   * that was attached BEFORE the handshake — passing the iterator into
   * {@link runConnection} ensures notifications pushed between the
   * handshake response and the moment we enter the event loop are
   * delivered instead of dropped.
   *
   * Races each await against a combined signal that aborts on either
   * shutdown OR manual reconnect, so an in-flight factory or handshake
   * doesn't block teardown or a user-initiated reconnect. The factory
   * receives the same combined signal so it can bail out internally
   * (matching the {@link HostTransportFactory} contract). The combined
   * signal's listeners are detached in a `finally` so successful
   * connects don't leak listeners on the long-lived shutdown signal.
   */
  private connectOnce;
  /**
   * Drain the connected client's event stream until it ends, the
   * shutdown signal aborts, or a manual reconnect is requested.
   */
  private runConnection;
  /** Park until a manual reconnect or shutdown wakes us up. */
  private waitForManualReconnectOrShutdown;
  private tearDownClient;
  private handleEvent;
  private applyEnvelopeLocally;
  private trackSubscription;
  private untrackSubscription;
  private transitionTo;
  private resetManualReconnectController;
  private makeReconnectAck;
}
//# sourceMappingURL=runtime.d.ts.map

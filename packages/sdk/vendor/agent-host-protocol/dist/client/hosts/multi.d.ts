/**
 * `MultiHostClient` façade.
 *
 * @module client/hosts/multi
 */
import type { URI } from "../../types/common/state.js";
import type { StateAction } from "../../types/common/actions.js";
import type { SubscribeResult } from "../../types/common/commands.js";
import type { DispatchHandle } from "../client.js";
import { HostClientHandle } from "./host-client-handle.js";
import {
  type HostConfig,
  type HostEvent,
  type HostHandle,
  type HostId,
  type HostSubscriptionEvent,
  type HostedAgent,
  type HostedSessionSummary,
} from "./types.js";
import { isConnected, isFailed } from "./types.js";
import { type ClientIdStore } from "./client-id-store.js";
/**
 * Concurrent registry of {@link HostHandle}s plus the supervisor tasks
 * that drive them.
 *
 * Cheap to clone — the inner state is reference-shared, so multiple UI
 * layers can hold their own reference and observe the same hosts.
 *
 * Common entry points:
 *
 * - {@link MultiHostClient.single} — one-line single-host constructor.
 * - {@link MultiHostClient.addHost} / {@link MultiHostClient.removeHost}.
 * - {@link MultiHostClient.events} / {@link MultiHostClient.hostEvents}.
 * - {@link MultiHostClient.aggregatedSessions} / {@link MultiHostClient.aggregatedAgents}.
 * - {@link MultiHostClient.reconnectAllUnavailable}.
 */
export declare class MultiHostClient {
  private readonly hosts;
  /**
   * Host ids currently mid-`addHost` (between the duplicate check and
   * the supervisor install). Keeps concurrent `addHost` calls for the
   * same id from both passing the duplicate check while one of them is
   * awaiting the {@link ClientIdStore}.
   */
  private readonly pendingHostIds;
  private readonly fanOut;
  private readonly hostEventsQueue;
  private readonly clientIdStore;
  /**
   * Aborted by {@link shutdown}. Passed into {@link ClientIdStore.load}
   * / {@link ClientIdStore.store} so slow store implementations can
   * bail out on shutdown — honouring the cancellation contract
   * documented on {@link ClientIdStore}.
   */
  private readonly shutdownController;
  private shutDown;
  /**
   * Build an empty multi-host client.
   *
   * @param options.clientIdStore Persistent store for stable per-host
   *   `clientId`s. Defaults to {@link InMemoryClientIdStore} which is
   *   session-stable only — provide your own (Keychain, `localStorage`,
   *   IndexedDB, Node `fs`, …) for cross-launch identity.
   * @param options.eventBuffer Buffer size for the cross-host fan-in
   *   broadcasts. Slow consumers that lag past this many events drop
   *   the gap, mirroring {@link AhpClient.events}. Default `1024`.
   */
  constructor(options?: {
    clientIdStore?: ClientIdStore;
    eventBuffer?: number;
  });
  /**
   * Convenience: construct a multi-host client with a single host
   * already registered, and return its initial {@link HostHandle}
   * snapshot. The handle reflects the host at the moment `addHost`
   * resolves — if the connect attempt is fast it may already be
   * `connected`, otherwise it may still be `connecting`.
   *
   * Designed so single-host consumers don't have to think about
   * registry concepts — `const { multi, host } = await MultiHostClient.single({ ... });`
   * is the whole onboarding.
   */
  static single(
    config: HostConfig,
    options?: {
      clientIdStore?: ClientIdStore;
      eventBuffer?: number;
    },
  ): Promise<{
    multi: MultiHostClient;
    host: HostHandle;
  }>;
  /**
   * Register a new host and start its supervisor.
   *
   * The supervisor immediately attempts to open a transport via
   * {@link HostConfig.transportFactory}, complete the `initialize`
   * handshake, and start fanning events. The returned snapshot reflects
   * the host's state at the moment this call returns — it may already
   * be `connected`, still `connecting`, or already `reconnecting` if
   * the first attempt failed.
   *
   * `clientId` is resolved here, before the supervisor is spawned:
   * `HostConfig.clientId` (if set) always wins, otherwise the
   * configured {@link ClientIdStore} is consulted; if it returns no
   * value a fresh UUID is generated. The resolved id is always written
   * back into the store.
   *
   * Throws {@link DuplicateHostError} if the host id is already in use
   * (or is currently being added by a concurrent caller).
   *
   * Throws {@link ClientIdStoreError} if the configured store fails to
   * load or persist the host's `clientId`.
   *
   * Throws {@link HostShutDownError} if the multi-host client has been
   * shut down — either before this call or while it was awaiting the
   * {@link ClientIdStore}. The pending-id reservation is always cleared
   * before returning, regardless of which error path is taken.
   */
  addHost(config: HostConfig): Promise<HostHandle>;
  /**
   * Remove a host, cancelling its supervisor and dropping the current
   * connection. Outstanding {@link HostClientHandle}s for this host
   * start throwing {@link HostShutDownError} once the runtime has
   * finished tearing down.
   *
   * Throws {@link UnknownHostError} if `id` is not registered.
   */
  removeHost(id: HostId): Promise<void>;
  /**
   * Trigger a manual reconnect for `id`. Cancels the current connection
   * (or pending backoff sleep) and immediately attempts a fresh
   * connect.
   */
  reconnectHost(id: HostId): Promise<void>;
  /**
   * Trigger a manual reconnect on every registered host that is
   * **not** currently `connected` or `connecting` — i.e. hosts in
   * `disconnected`, `reconnecting`, or `failed`. Hosts already
   * connected (or actively connecting) are skipped.
   *
   * Designed for the mobile scene-phase pattern: when the app returns
   * from background, call this to wake every host the user has been
   * away from instead of writing the loop in every consumer. Useful in
   * particular for `failed` hosts whose reconnect policy is exhausted —
   * a manual reconnect bypasses the policy and starts a fresh attempt.
   *
   * Reconnect requests are dispatched concurrently. Per-host errors
   * are collected into the returned map; the call itself never throws.
   */
  reconnectAllUnavailable(): Promise<Map<HostId, Error>>;
  /**
   * Snapshot the current state of `id`. Returns `undefined` if the
   * host is not registered.
   */
  host(id: HostId): HostHandle | undefined;
  /** Snapshot every registered host. Order is insertion order. */
  hostsSnapshot(): HostHandle[];
  /**
   * Acquire a generation-checked client handle for `id`.
   *
   * Returns `undefined` if the host is not registered or has no live
   * connection. The returned handle refuses to dispatch through a
   * connection that has been replaced by a reconnect — request a fresh
   * handle in that case.
   */
  client(id: HostId): HostClientHandle | undefined;
  /** Convenience: subscribe to `uri` on `hostId`. */
  subscribe(hostId: HostId, uri: URI): Promise<SubscribeResult>;
  /** Convenience: unsubscribe from `uri` on `hostId`. */
  unsubscribe(hostId: HostId, uri: URI): Promise<void>;
  /** Convenience: dispatch `action` on `channel` against `hostId`. */
  dispatch(
    hostId: HostId,
    channel: URI,
    action: StateAction,
    clientSeq?: number,
  ): DispatchHandle;
  /**
   * Subscribe to a fan-in stream of every inbound event from every
   * registered host. Each call returns a fresh independent iterator —
   * multiple consumers can listen independently.
   *
   * Events buffered before the iterator was created are not replayed;
   * iterators start at the next event. Slow consumers that lag past
   * the buffer (default 1024) skip the gap, matching {@link AhpClient.events}.
   */
  events(): AsyncIterableIterator<HostSubscriptionEvent>;
  /** Subscribe to connection-state events for UX. Each call returns a fresh iterator. */
  hostEvents(): AsyncIterableIterator<HostEvent>;
  /**
   * Aggregated session summaries across every registered host, sorted
   * by `summary.modifiedAt` descending. Includes both the host id and
   * label so consumers can render a unified inbox without losing host
   * attribution.
   */
  aggregatedSessions(): HostedSessionSummary[];
  /**
   * Aggregated agents across every registered host, in registration
   * order per host.
   */
  aggregatedAgents(): HostedAgent[];
  /**
   * Gracefully shut down every host and tear down the internal event
   * fan-in queues. Idempotent.
   *
   * After `shutdown` resolves, subsequent calls to `addHost` /
   * `reconnectHost` / `dispatch` / `subscribe` throw, and active event
   * iterators see end-of-stream.
   */
  shutdown(): Promise<void>;
  private assertOpen;
  private resolveClientId;
}
export { isConnected, isFailed };
//# sourceMappingURL=multi.d.ts.map

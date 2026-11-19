/**
 * Shared, reference-counted ownership for AHP subscriptions.
 *
 * @module client/managed-subscriptions
 */
import type { SubscribeResult } from "../types/common/commands.js";
import type { Snapshot, URI } from "../types/common/state.js";
import { type AhpClient, type SubscribeOptions } from "./client.js";
import type { SubscriptionEvent } from "./events.js";
/** Lifecycle state of a shared managed subscription. */
export type ManagedSubscriptionStatus =
  | "pending"
  | "active"
  | "failed"
  | "closed";
/** A named owner retaining a shared subscription. */
export interface ManagedSubscriptionHolder {
  readonly owner: string;
  readonly count: number;
}
/** Read-only inspection data for one managed subscription. */
export interface ManagedSubscriptionInfo {
  readonly uri: URI;
  readonly status: ManagedSubscriptionStatus;
  readonly refCount: number;
  readonly holders: readonly ManagedSubscriptionHolder[];
}
/**
 * A subscribe result whose snapshot state has been narrowed by the consumer.
 *
 * The wire owner remains the generated {@link SubscribeResult}; this type only
 * gives handwritten client code the same caller-selected state typing that
 * VS Code's subscription manager exposes for its resource kinds.
 */
export type ManagedSubscribeResult<
  TState extends Snapshot["state"] = Snapshot["state"],
> = Omit<SubscribeResult, "snapshot"> & {
  readonly snapshot?: Omit<Snapshot, "state"> & {
    readonly state: TState;
  };
};
/**
 * Shared state for one wire-level subscription.
 *
 * The object remains valid for the lifetime of every lease that acquired it.
 * Await {@link ManagedSubscription.ready} for the initial subscribe result;
 * events received during that round-trip are retained by each lease's event
 * iterator and delivered afterward in wire order.
 */
export interface ManagedSubscription<
  TState extends Snapshot["state"] = Snapshot["state"],
> {
  readonly uri: URI;
  readonly ready: Promise<ManagedSubscribeResult<TState>>;
  readonly status: ManagedSubscriptionStatus;
  /** Initial subscribe result, once {@link ready} has resolved. */
  readonly result: ManagedSubscribeResult<TState> | undefined;
  /** Subscribe failure, when {@link status} is `failed`. */
  readonly error: Error | undefined;
}
/**
 * One holder's lease on a shared managed subscription.
 *
 * {@link events} is attached before the wire-level `subscribe` request is
 * sent. Disposal is idempotent; disposing the final lease sends the protocol
 * `unsubscribe` notification.
 */
export interface ManagedSubscriptionLease<
  TState extends Snapshot["state"] = Snapshot["state"],
  TEvent extends SubscriptionEvent = SubscriptionEvent,
> extends Disposable {
  readonly subscription: ManagedSubscription<TState>;
  readonly events: AsyncIterableIterator<TEvent>;
}
/**
 * Owns one wire-level subscription per URI and shares it across named leases.
 *
 * Concurrent acquires coalesce onto the same request. A failed request is
 * removed from the manager after its local attachment is cleaned up, so the
 * next acquire deterministically makes a fresh request. Releasing the last
 * lease tears down both local fan-out and the server subscription.
 */
export declare class ManagedSubscriptionManager {
  private readonly client;
  private readonly eventBuffer;
  private readonly entries;
  private nextHolderId;
  private closed;
  constructor(
    client: AhpClient,
    options?: {
      eventBuffer?: number;
    },
  );
  /**
   * Acquire a named lease for `uri`.
   *
   * The first acquire starts the wire request. Later acquires share its result
   * and event fan-out. All holders for a URI must use the same subscribe
   * options; conflicting options throw rather than silently changing the
   * already-active server subscription.
   */
  acquire<
    TState extends Snapshot["state"] = Snapshot["state"],
    TEvent extends SubscriptionEvent = SubscriptionEvent,
  >(
    uri: URI,
    owner: string,
    options?: SubscribeOptions,
  ): ManagedSubscriptionLease<TState, TEvent>;
  /** Current managed subscription without acquiring another lease. */
  get<TState extends Snapshot["state"] = Snapshot["state"]>(
    uri: URI,
  ): ManagedSubscription<TState> | undefined;
  /** Active subscription URIs, in deterministic lexical order. */
  currentSubscriptionUris(): URI[];
  /** Read-only lifecycle and ownership snapshot for diagnostics. */
  activeSubscriptions(): ManagedSubscriptionInfo[];
  /** Release every managed subscription and reject future acquires. */
  close(): Promise<void>;
  private createLease;
  private start;
  private pump;
  private disposeEntry;
}
//# sourceMappingURL=managed-subscriptions.d.ts.map

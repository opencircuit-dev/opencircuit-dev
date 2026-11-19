/**
 * Async JSON-RPC client for the Agent Host Protocol.
 *
 * Mirrors the surface of the Rust `ahp::Client`: a transport-agnostic
 * client that runs a background receive loop over a pluggable
 * {@link AhpTransport}, exposes typed `initialize` / `reconnect` /
 * `subscribe` / `dispatch` helpers, and fans inbound notifications out to
 * per-URI {@link Subscription}s and a top-level {@link AhpClient.events}
 * stream.
 *
 * @module client/client
 */
import type { StateAction } from "../types/actions.js";
import type {
  InitializeResult,
  ReconnectResult,
  ResourceReadParams,
  ResourceReadResult,
  ResourceWriteParams,
  ResourceWriteResult,
  ResourceListParams,
  ResourceListResult,
  ResourceCopyParams,
  ResourceCopyResult,
  ResourceDeleteParams,
  ResourceDeleteResult,
  ResourceMoveParams,
  ResourceMoveResult,
  ResourceResolveParams,
  ResourceResolveResult,
  ResourceMkdirParams,
  ResourceMkdirResult,
  ResourceRequestParams,
  ResourceRequestResult,
  SubscribeView,
  SubscriptionDeliveryOptions,
  SubscribeResult,
} from "../types/common/commands.js";
import type {
  CreateResourceWatchParams,
  CreateResourceWatchResult,
} from "../types/channels-resource-watch/commands.js";
import type {
  CompletionsParams,
  CompletionsResult,
} from "../types/channels-session/commands.js";
import type {
  SessionConfigCompletionsParams,
  SessionConfigCompletionsResult,
} from "../types/channels-root/commands.js";
import type {
  CommandMap,
  ClientNotificationMap,
  ServerCommandMap,
} from "../types/common/messages.js";
import type { URI } from "../types/common/state.js";
import type {
  ClientEvent,
  ConnectionState,
  SubscriptionEvent,
} from "./events.js";
import { type AhpTransport } from "./transport.js";
/** Configuration for an {@link AhpClient}. */
export interface AhpClientConfig {
  /**
   * Maximum time in milliseconds to wait for a request to resolve before
   * failing with {@link RpcTimeoutError}. Default `30000`. Set to `0` or
   * a negative number to disable the default timeout.
   */
  requestTimeoutMs?: number;
  /**
   * Maximum number of events buffered per subscription. Slow consumers
   * that lag by more than this many events will skip the gap (oldest
   * events are dropped). Default `4096`.
   */
  subscriptionBuffer?: number;
}
/** Optional preferences for a `subscribe` request. */
export interface SubscribeOptions {
  /** Advisory delivery preferences for this subscription. */
  delivery?: SubscriptionDeliveryOptions;
  /** Optional client-requested shape for the returned snapshot. */
  view?: SubscribeView;
}
/**
 * Handle to a single resource subscription. Iterate to receive
 * {@link SubscriptionEvent}s. Call {@link Subscription.close} to terminate
 * this consumer's iterator (the server-side subscription is released only
 * when {@link AhpClient.unsubscribe} is called for this URI).
 */
export declare class Subscription
  implements AsyncIterableIterator<SubscriptionEvent>
{
  /** Channel URI this subscription is bound to. */
  readonly uri: URI;
  /** @internal */
  private readonly inner;
  /** @internal */
  constructor(uri: URI, inner: AsyncIterableIterator<SubscriptionEvent>);
  next(): Promise<IteratorResult<SubscriptionEvent>>;
  return(): Promise<IteratorResult<SubscriptionEvent>>;
  [Symbol.asyncIterator](): this;
  /** Terminate this consumer's iterator. Does not unsubscribe server-side. */
  close(): Promise<void>;
}
/** Result of {@link AhpClient.dispatch}. */
export interface DispatchHandle {
  /** Client-local sequence number assigned to this dispatch. */
  readonly clientSeq: number;
}
/**
 * Handler for inbound server-initiated requests. Should return a value
 * matching the corresponding `ServerCommandMap[M]['result']`, or throw an
 * {@link RpcError} to send back an error response.
 */
export type ServerRequestHandler = <M extends keyof ServerCommandMap>(
  method: M,
  params: ServerCommandMap[M]["params"],
) => Promise<ServerCommandMap[M]["result"]>;
/**
 * Typed per-method handlers for inbound server-initiated resource requests.
 *
 * Every method of {@link ServerCommandMap} (the symmetrical `resource*`
 * family) maps to an optional handler that receives the decoded params and
 * returns — or resolves to — the matching result. This is the typed layer
 * over the generic {@link ServerRequestHandler}: install it with
 * {@link AhpClient.setResourceRequestHandlers}, or compose it yourself with
 * {@link createResourceRequestHandler}. A method left undefined is reported
 * back to the peer as JSON-RPC `MethodNotFound`.
 */
export type ResourceRequestHandlers = {
  [M in keyof ServerCommandMap]?: (
    params: ServerCommandMap[M]["params"],
  ) => Promise<ServerCommandMap[M]["result"]> | ServerCommandMap[M]["result"];
};
/**
 * Compose a set of typed per-method {@link ResourceRequestHandlers} into a
 * single {@link ServerRequestHandler} suitable for
 * {@link AhpClient.setServerRequestHandler}. Requests whose method has no
 * registered handler reject with a JSON-RPC `MethodNotFound` {@link RpcError}.
 */
export declare function createResourceRequestHandler(
  handlers: ResourceRequestHandlers,
): ServerRequestHandler;
/**
 * Async JSON-RPC client driving a pluggable {@link AhpTransport}.
 *
 * The receive loop is started by {@link AhpClient.connect} and runs until
 * the transport closes or {@link AhpClient.shutdown} is called. In-flight
 * requests reject with {@link ClientClosedError} when the client is shut
 * down.
 */
export declare class AhpClient {
  private readonly transport;
  private readonly requestTimeoutMs;
  private readonly subscriptionBuffer;
  private readonly pending;
  private readonly subscriptions;
  private readonly allEvents;
  private readonly stateQueue;
  private nextRequestId;
  private nextClientSeq;
  private state;
  private receiveLoop;
  private serverRequestHandler;
  constructor(transport: AhpTransport, config?: AhpClientConfig);
  /** Current connection state. */
  get connectionState(): ConnectionState;
  /** AsyncIterable stream of connection-state transitions. */
  stateChanges(): AsyncIterableIterator<ConnectionState>;
  /**
   * Top-level fan-in stream of every inbound event from this client.
   *
   * Each call returns a fresh independent iterator. Events are also
   * delivered to the matching per-URI {@link Subscription}.
   */
  events(): AsyncIterableIterator<ClientEvent>;
  /**
   * Install a handler for server-initiated requests
   * ({@link ServerCommandMap}). If no handler is installed, the client
   * responds with a JSON-RPC `MethodNotFound` error so the server does
   * not leak pending requests.
   */
  setServerRequestHandler(handler: ServerRequestHandler | null): void;
  /**
   * Install typed per-method handlers for inbound server-initiated resource
   * requests ({@link ServerCommandMap}). Sugar over
   * {@link AhpClient.setServerRequestHandler} +
   * {@link createResourceRequestHandler}: a method left undefined is reported
   * to the peer as JSON-RPC `MethodNotFound`. Pass `null` to clear the
   * installed handler.
   */
  setResourceRequestHandlers(handlers: ResourceRequestHandlers | null): void;
  /**
   * Start the inbound receive loop. Idempotent — calling more than once
   * is a no-op.
   */
  connect(): void;
  /**
   * Gracefully shut down the client. Closes the transport, rejects every
   * pending request with {@link ClientClosedError}, and terminates all
   * subscription and event streams.
   */
  shutdown(): Promise<void>;
  /**
   * Send the `initialize` handshake. MUST be the first request after
   * {@link AhpClient.connect}.
   */
  initialize(args: {
    clientId: string;
    protocolVersions: readonly string[];
    initialSubscriptions?: readonly URI[];
    locale?: string;
  }): Promise<InitializeResult>;
  /** Re-establish a dropped connection. */
  reconnect(args: {
    clientId: string;
    lastSeenServerSeq: number;
    subscriptions: readonly URI[];
  }): Promise<ReconnectResult>;
  /**
   * Subscribe to a URI and obtain a {@link Subscription} that streams
   * subsequent events. The returned subscription is registered locally
   * before the `subscribe` request is sent, so no events delivered during
   * the round-trip are missed.
   */
  subscribe(
    uri: URI,
    options?: SubscribeOptions,
  ): Promise<{
    result: SubscribeResult;
    subscription: Subscription;
  }>;
  /**
   * Attach a new local {@link Subscription} without sending a `subscribe`
   * request — use this when the URI was included in `initialSubscriptions`
   * during {@link AhpClient.initialize}, or to add an additional consumer
   * for a URI that is already subscribed.
   *
   * Throws {@link ClientClosedError} after the client has been shut down.
   */
  attachSubscription(uri: URI): Subscription;
  /**
   * Send an `unsubscribe` notification and drop the local fan-out for
   * this URI. Any active {@link Subscription} iterators terminate.
   *
   * No-op after the client has been shut down.
   */
  unsubscribe(uri: URI): Promise<void>;
  /**
   * Fire a write-ahead `dispatchAction` notification.
   *
   * If `clientSeq` is omitted, the client uses its internal monotonic
   * counter. If supplied, the counter advances to `max(current,
   * clientSeq + 1)` so subsequent auto-assigned sequences remain
   * monotonic.
   *
   * Throws {@link ClientClosedError} after the client has been shut down.
   */
  dispatch(
    channel: URI,
    action: StateAction,
    clientSeq?: number,
  ): DispatchHandle;
  /**
   * Protocol-level liveness ping. Useful in browsers, which cannot send
   * WebSocket ping frames directly.
   *
   * `ping` is a connection-level command; its channel is always
   * `ahp-root://`.
   */
  ping(): Promise<void>;
  /** Read the content of a resource by URI (`resourceRead`). */
  resourceRead(
    params: Omit<ResourceReadParams, "channel">,
  ): Promise<ResourceReadResult>;
  /** Write content to a file on the receiver's filesystem (`resourceWrite`). */
  resourceWrite(
    params: Omit<ResourceWriteParams, "channel">,
  ): Promise<ResourceWriteResult>;
  /** List directory entries at a file URI (`resourceList`). */
  resourceList(
    params: Omit<ResourceListParams, "channel">,
  ): Promise<ResourceListResult>;
  /** Copy a resource from one URI to another (`resourceCopy`). */
  resourceCopy(
    params: Omit<ResourceCopyParams, "channel">,
  ): Promise<ResourceCopyResult>;
  /** Delete a resource at a URI (`resourceDelete`). */
  resourceDelete(
    params: Omit<ResourceDeleteParams, "channel">,
  ): Promise<ResourceDeleteResult>;
  /** Move (rename) a resource from one URI to another (`resourceMove`). */
  resourceMove(
    params: Omit<ResourceMoveParams, "channel">,
  ): Promise<ResourceMoveResult>;
  /** Resolve a resource — `stat` + `realpath` (`resourceResolve`). */
  resourceResolve(
    params: Omit<ResourceResolveParams, "channel">,
  ): Promise<ResourceResolveResult>;
  /** Create a directory with `mkdir -p` semantics (`resourceMkdir`). */
  resourceMkdir(
    params: Omit<ResourceMkdirParams, "channel">,
  ): Promise<ResourceMkdirResult>;
  /** Request permission to access a resource (`resourceRequest`). */
  resourceRequest(
    params: Omit<ResourceRequestParams, "channel">,
  ): Promise<ResourceRequestResult>;
  /**
   * Create a resource watcher (`createResourceWatch`). Returns the
   * `ahp-resource-watch:/<id>` channel URI; {@link AhpClient.subscribe} to it
   * to receive change events, and {@link AhpClient.unsubscribe} to release the
   * watcher.
   */
  createResourceWatch(
    params: Omit<CreateResourceWatchParams, "channel">,
  ): Promise<CreateResourceWatchResult>;
  /**
   * Request inline completion items for a partially-typed input
   * (`completions`), e.g. to power `@`-mention pickers. Unlike the `resource*`
   * wrappers, the caller-supplied `channel` (the chat URI the completion is
   * scoped to) is preserved. Debounce calls to avoid flooding the server on
   * every keystroke.
   */
  completions(params: CompletionsParams): Promise<CompletionsResult>;
  /**
   * Query the server for allowed values of a dynamic session config property
   * (`sessionConfigCompletions`). Targets the root channel, so callers omit
   * `channel`.
   */
  sessionConfigCompletions(
    params: Omit<SessionConfigCompletionsParams, "channel">,
  ): Promise<SessionConfigCompletionsResult>;
  /** Send a JSON-RPC request and await its result. */
  request<M extends keyof CommandMap>(
    method: M,
    params: CommandMap[M]["params"],
  ): Promise<CommandMap[M]["result"]>;
  /**
   * Send a JSON-RPC notification (fire-and-forget).
   *
   * Throws {@link ClientClosedError} after the client has been shut down.
   * Transport-level send failures surface synchronously via
   * {@link AhpClient.connectionState} (the receive loop also tears down
   * on the next inbound failure).
   */
  notify<M extends keyof ClientNotificationMap>(
    method: M,
    params: ClientNotificationMap[M]["params"],
  ): void;
  private isClosed;
  private assertOpen;
  private sendMessage;
  private setState;
  private tearDown;
  private driveTransport;
  private handleFrame;
  private dispatchInbound;
  private handleServerRequest;
  private handleNotification;
  private fanOut;
}
//# sourceMappingURL=client.d.ts.map

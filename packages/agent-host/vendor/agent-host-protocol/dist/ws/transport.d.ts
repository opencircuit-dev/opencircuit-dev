/**
 * WebSocket transport adapter for the {@link AhpClient}.
 *
 * Built on the global {@link WebSocket} constructor, so it works in
 * browsers and in Node 21+ without additional dependencies.
 *
 * @module ws/transport
 */
import { type AhpTransport, type TransportFrame } from "../client/transport.js";
import type { ProtocolMessage } from "../types/common/messages.js";
/** Options for {@link WebSocketTransport.connect}. */
export interface WebSocketTransportOptions {
  /**
   * WebSocket subprotocols to negotiate. Browsers do not allow setting
   * arbitrary HTTP headers; subprotocols and query-string parameters are
   * the main extension points.
   */
  protocols?: string | string[];
}
/** Information about a transport close. */
export interface WebSocketCloseInfo {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}
/**
 * An {@link AhpTransport} backed by the global {@link WebSocket}.
 *
 * Browser caveats this transport exposes:
 *
 * - {@link send} only queues data; it does not wait for the bytes to be
 *   flushed to the socket. Use {@link bufferedAmount} to detect
 *   backpressure if needed.
 * - Browsers cannot send WebSocket ping frames. Use {@link AhpClient.ping}
 *   for protocol-level liveness.
 * - Custom HTTP headers are not supported; use subprotocols or
 *   query-string parameters for auth.
 */
export declare class WebSocketTransport implements AhpTransport {
  private readonly socket;
  private readonly inbox;
  private waiters;
  private closeInfo;
  private error;
  private closed;
  /**
   * Open a new WebSocket connection.
   *
   * Resolves once the socket emits `open`. Rejects with a
   * {@link TransportError} on early failure — either an `error` event or a
   * `close` event before `open`.
   */
  static connect(
    url: string | URL,
    options?: WebSocketTransportOptions,
  ): Promise<WebSocketTransport>;
  /**
   * Wrap an already-open WebSocket. Use this when you need to control
   * the handshake (custom subprotocols, query params, an existing
   * connection from another library).
   *
   * The socket MUST already be in the `OPEN` state.
   */
  static fromSocket(socket: WebSocket): WebSocketTransport;
  private constructor();
  /** Bytes still queued in the underlying socket's send buffer. */
  get bufferedAmount(): number;
  /**
   * Information about the most recent close, set once the socket emits
   * `close`. `null` while the connection is open.
   */
  get lastClose(): WebSocketCloseInfo | null;
  send(message: ProtocolMessage | string): void;
  recv(): Promise<TransportFrame | null>;
  close(): Promise<void>;
  private deliver;
  private drainWithError;
  private drainWithNull;
}
//# sourceMappingURL=transport.d.ts.map

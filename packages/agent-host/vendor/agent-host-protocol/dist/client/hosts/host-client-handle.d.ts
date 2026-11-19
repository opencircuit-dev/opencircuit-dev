/**
 * Generation-checked handle to the underlying single-host {@link AhpClient}.
 *
 * Issued by {@link MultiHostClient.client}. Every dispatch through this
 * handle verifies that the host is still on the generation the handle
 * was minted at; if a reconnect has occurred, dispatching throws
 * {@link HostReconnectedError} instead of silently writing to the new
 * connection. Removing the host marks the handle as shut down and
 * subsequent calls throw {@link HostShutDownError}.
 *
 * @module client/hosts/host-client-handle
 */
import type { CommandMap } from "../../types/common/messages.js";
import type { StateAction } from "../../types/common/actions.js";
import type { URI } from "../../types/common/state.js";
import type { AhpClient, DispatchHandle } from "../client.js";
import { type HostId } from "./types.js";
/**
 * Internal handle reference used by the runtime to mint
 * {@link HostClientHandle}s. The runtime updates `generation`,
 * `currentClient`, and `shutdownReason` as connections come and go;
 * minted handles read them through this shared reference.
 *
 * @internal
 */
export interface HostClientHandleSource {
  readonly hostId: HostId;
  generation: number;
  currentClient: AhpClient | null;
  shutdownReason: null | "removed" | "shutdown";
}
/**
 * Generation-checked wrapper around the per-host {@link AhpClient}.
 *
 * Acquired via {@link MultiHostClient.client}. Cheap to clone — the
 * underlying client and shared state are reference-shared.
 */
export declare class HostClientHandle {
  /** Host this handle was issued for. */
  readonly hostId: HostId;
  /** Generation this handle was minted at. */
  readonly generation: number;
  private readonly source;
  private readonly client;
  /** @internal */
  constructor(
    source: HostClientHandleSource,
    generation: number,
    client: AhpClient,
  );
  /**
   * Validate this handle against the host's current generation and
   * shutdown state. Throws {@link HostShutDownError} or
   * {@link HostReconnectedError} on failure.
   */
  checkAlive(): void;
  /**
   * Dispatch an action through this connection, refusing if the
   * connection has been replaced by a reconnect or the host has been
   * removed.
   */
  dispatch(
    channel: URI,
    action: StateAction,
    clientSeq?: number,
  ): DispatchHandle;
  /**
   * Issue an arbitrary typed JSON-RPC request through this connection,
   * refusing if the connection has been replaced by a reconnect or the
   * host has been removed.
   */
  request<M extends keyof CommandMap>(
    method: M,
    params: CommandMap[M]["params"],
  ): Promise<CommandMap[M]["result"]>;
  /**
   * Borrow the underlying {@link AhpClient} for advanced use. The
   * caller is responsible for not holding it past the next reconnect —
   * the returned reference can become stale at any await point.
   */
  rawClient(): AhpClient;
}
//# sourceMappingURL=host-client-handle.d.ts.map

/**
 * Host-aware reducer façade for multi-host consumers.
 *
 * Wraps the existing pure reducers (`rootReducer`, `sessionReducer`,
 * `terminalReducer`, `changesetReducer`) the way a single-host
 * consumer would, but keys session/terminal/changeset state by
 * `(hostId, uri)` so URIs that legitimately collide across hosts (the
 * normal case for session URIs) don't clobber each other.
 *
 * # Event sources are lossy today
 *
 * Both event surfaces the TypeScript SDK exposes are
 * {@link AsyncBroadcastQueue}-backed and **drop envelopes on slow
 * consumers** once their buffer fills:
 *
 * - {@link MultiHostClient.events} — the cross-host fan-in.
 * - {@link AhpClient.subscribe} / {@link AhpClient.attachSubscription}
 *   — per-channel {@link Subscription}.
 *
 * Neither survives a reconnect's replayed envelopes the way the Swift
 * SDK's per-channel `events(host:uri:)` does. A dropped envelope (or
 * a missed-because-reconnected envelope) permanently desyncs the
 * mirror for that `(host, channel)` until it's re-seeded from a fresh
 * snapshot via {@link MultiHostStateMirror.applySnapshot}. Consume
 * with that in mind — the mirror is the right shape for multi-host UI
 * state, but the SDK doesn't yet ship a lossless feeder.
 *
 * @module client/hosts/state-mirror
 */
import { type ActionEnvelope } from "../../types/common/actions.js";
import type { Snapshot, URI } from "../../types/common/state.js";
import type { ChangesetState } from "../../types/channels-changeset/state.js";
import type { CanvasState } from "../../types/channels-canvas/state.js";
import type { RootState } from "../../types/channels-root/state.js";
import type { SessionState } from "../../types/channels-session/state.js";
import type { TerminalState } from "../../types/channels-terminal/state.js";
import type {
  AutomationEntry,
  AutomationState,
} from "../../types/channels-automation/state.js";
import type { AutomationRunState } from "../../types/channels-automation-run/state.js";
import { type HostId, type HostSubscriptionEvent } from "./types.js";
/**
 * Compound key tagging a channel URI with the host that produced it.
 *
 * Session, terminal, and changeset URIs aren't globally unique across
 * hosts — `ahp-session:/s1` on Host A and `ahp-session:/s1` on Host B
 * are different resources. Compose into a string for Map keys so we
 * don't depend on reference identity.
 *
 * The encoding is length-prefixed (`${hostId.length}\0${hostId}${uri}`)
 * rather than a plain separator-joined string so that any character
 * (including `\0`) inside a {@link HostId} or {@link URI} is
 * unambiguous. Two different (`hostId`, `uri`) pairs always produce
 * distinct keys.
 */
export interface HostedResourceKey {
  readonly hostId: HostId;
  readonly uri: URI;
}
/**
 * Build a Map-stable key string from a {@link HostedResourceKey}.
 *
 * The encoding is length-prefixed so it stays unambiguous even when
 * a {@link HostId} contains `\0` or other characters that would
 * otherwise collide with the separator.
 */
export declare function hostedResourceKey(hostId: HostId, uri: URI): string;
/**
 * In-memory mirror of per-host root/session/terminal/changeset state,
 * fed by {@link ActionEnvelope}s and snapshot states tagged with their
 * host of origin.
 *
 * Single-host consumers should keep using {@link AhpStateMirror}; this
 * type adds the host dimension necessary for multi-host UIs.
 *
 * See the module-level docs for a warning about lossy event sources.
 */
export declare class MultiHostStateMirror {
  private readonly rootStatesMap;
  private readonly sessionsMap;
  private readonly canvasesMap;
  private readonly terminalsMap;
  private readonly changesetsMap;
  private readonly automationCatalogsMap;
  private readonly automationsMap;
  private readonly automationRunsMap;
  /** All known root states keyed by host. */
  get rootStates(): ReadonlyMap<HostId, RootState>;
  /** All known session states keyed by `hostedResourceKey(hostId, uri)`. */
  get sessions(): ReadonlyMap<string, SessionState>;
  /** Live canvases keyed by `hostedResourceKey(hostId, uri)`. */
  get canvases(): ReadonlyMap<string, CanvasState>;
  /** All known terminal states keyed by `hostedResourceKey(hostId, uri)`. */
  get terminals(): ReadonlyMap<string, TerminalState>;
  /** All known changeset states keyed by `hostedResourceKey(hostId, uri)`. */
  get changesets(): ReadonlyMap<string, ChangesetState>;
  /** Automation catalogue state keyed by host. */
  get automationCatalogs(): ReadonlyMap<HostId, AutomationState>;
  /** Catalogued automations keyed by `hostedResourceKey(hostId, resource)`. */
  get automations(): ReadonlyMap<string, AutomationEntry>;
  get automationRuns(): ReadonlyMap<string, AutomationRunState>;
  /** Look up the root state for `hostId`. */
  getRoot(hostId: HostId): RootState | undefined;
  /** Look up a session by `(hostId, uri)`. */
  getSession(hostId: HostId, uri: URI): SessionState | undefined;
  getCanvas(hostId: HostId, uri: URI): CanvasState | undefined;
  /** Look up a terminal by `(hostId, uri)`. */
  getTerminal(hostId: HostId, uri: URI): TerminalState | undefined;
  /** Look up a changeset by `(hostId, uri)`. */
  getChangeset(hostId: HostId, uri: URI): ChangesetState | undefined;
  /** Look up a catalogued automation by `(hostId, uri)`. */
  getAutomation(hostId: HostId, uri: URI): AutomationEntry | undefined;
  /**
   * Convenience: apply a {@link HostSubscriptionEvent} produced by
   * {@link MultiHostClient.events}. Action envelopes are routed through
   * the matching reducer; non-action events (session-summary
   * notifications, auth challenges) are ignored — they don't move any
   * of the reducer-tracked state shapes.
   */
  applyEvent(event: HostSubscriptionEvent): void;
  /**
   * Apply a single action envelope scoped to `hostId`. Routing uses
   * `envelope.channel`: {@link ROOT_RESOURCE_URI} is the root channel,
   * every other URI is identified by the channel the server announces.
   */
  applyEnvelope(hostId: HostId, envelope: ActionEnvelope): void;
  /**
   * Seed the mirror from a {@link Snapshot} scoped to `hostId` — root,
   * session, terminal, or changeset as the snapshot's `state` shape
   * dictates.
   */
  applySnapshot(hostId: HostId, snapshot: Snapshot): void;
  /** Drop every slot keyed under `hostId` — root, sessions, terminals, changesets. */
  resetHost(hostId: HostId): void;
  /** Drop every host's state. */
  reset(): void;
  private setAutomationCatalog;
}
//# sourceMappingURL=state-mirror.d.ts.map

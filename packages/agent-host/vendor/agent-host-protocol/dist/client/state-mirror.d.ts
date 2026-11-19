/**
 * Convenience reducer-driven state store, mirroring the Swift
 * `AHPStateMirror` and the Rust reducers example.
 *
 * Tracks root, session, canvas, terminal, changeset, automation catalogue, and
 * automation-run state. Apply {@link Snapshot}s and {@link ActionEnvelope}s and
 * the mirror keeps those resources up to date via the generated reducers.
 *
 * Useful for simple clients. Larger apps will usually keep their own
 * state and call the reducers directly.
 *
 * @module client/state-mirror
 */
import { type ActionEnvelope } from "../types/common/actions.js";
import type { Snapshot, URI } from "../types/common/state.js";
import type { ChangesetState } from "../types/channels-changeset/state.js";
import type { CanvasState } from "../types/channels-canvas/state.js";
import type { RootState } from "../types/channels-root/state.js";
import type { SessionState } from "../types/channels-session/state.js";
import type { TerminalState } from "../types/channels-terminal/state.js";
import type {
  AutomationEntry,
  AutomationState,
} from "../types/channels-automation/state.js";
import type { AutomationRunState } from "../types/channels-automation-run/state.js";
/** Reducer-driven state container synchronised with server events. */
export declare class AhpStateMirror {
  private rootState;
  private readonly sessionsMap;
  private readonly canvasesMap;
  private readonly terminalsMap;
  private readonly changesetsMap;
  private automationCatalogState;
  private readonly automationsMap;
  private readonly automationRunsMap;
  /** Current root state. */
  get root(): RootState;
  /** All known sessions keyed by URI. */
  get sessions(): ReadonlyMap<URI, SessionState>;
  /** All known live canvases keyed by their channel URI. */
  get canvases(): ReadonlyMap<URI, CanvasState>;
  /** All known terminals keyed by URI. */
  get terminals(): ReadonlyMap<URI, TerminalState>;
  /** All known changesets keyed by URI. */
  get changesets(): ReadonlyMap<URI, ChangesetState>;
  /** Current automation catalogue state. */
  get automationCatalog(): AutomationState;
  /** All catalogued automations keyed by their stable resource URI. */
  get automations(): ReadonlyMap<URI, AutomationEntry>;
  get automationRuns(): ReadonlyMap<URI, AutomationRunState>;
  /** Look up a session by URI. */
  getSession(uri: URI): SessionState | undefined;
  getCanvas(uri: URI): CanvasState | undefined;
  /** Look up a terminal by URI. */
  getTerminal(uri: URI): TerminalState | undefined;
  /** Look up a catalogued automation by URI. */
  getAutomation(uri: URI): AutomationEntry | undefined;
  /**
   * Apply a server snapshot, replacing the state for the resource the
   * snapshot covers.
   */
  applySnapshot(snapshot: Snapshot): void;
  /**
   * Apply a server-pushed {@link ActionEnvelope}, routing through the
   * matching reducer. Unknown channels are ignored.
   *
   * The channel-based routing here discriminates which reducer applies;
   * the action is cast to the appropriate per-channel subset (the
   * `RootAction` / `SessionAction` / `TerminalAction` / `ChangesetAction`
   * unions generated from `@clientDispatchable` annotations) because
   * TypeScript cannot infer that narrowing from the channel string alone.
   */
  apply(envelope: ActionEnvelope): void;
  private setAutomationCatalog;
}
//# sourceMappingURL=state-mirror.d.ts.map

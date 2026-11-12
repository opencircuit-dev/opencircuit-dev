/**
 * Common Reducer Helpers — Shared reducer utilities (`softAssertNever`,
 * dispatch validation) used by the per-channel reducers.
 *
 * @module common/reducer-helpers
 */
import type {
  RootAction,
  ClientRootAction,
  SessionAction,
  ClientSessionAction,
  TerminalAction,
  ClientTerminalAction,
  ChangesetAction,
  ClientChangesetAction,
  AnnotationsAction,
  ClientAnnotationsAction,
  AutomationAction,
  ClientAutomationAction,
  AutomationRunAction,
  ClientAutomationRunAction,
} from "../action-origin.generated.js";
/**
 * Soft assertion for exhaustiveness checking. Place in the `default` branch of
 * a switch on a discriminated union so the compiler errors when a new variant
 * is added but not handled.
 *
 * At runtime, logs a warning instead of throwing so that forward-compatible
 * clients receiving unknown actions from a newer server degrade gracefully.
 */
export declare function softAssertNever(
  value: never,
  log?: (msg: string) => void,
): void;
/**
 * Type guard that checks whether an action may be dispatched by a client.
 *
 * Servers SHOULD call this to validate incoming `dispatchAction` requests
 * and reject any action the client is not allowed to originate.
 */
export declare function isClientDispatchable(
  action:
    | RootAction
    | SessionAction
    | TerminalAction
    | ChangesetAction
    | AnnotationsAction
    | AutomationAction
    | AutomationRunAction,
): action is
  | ClientRootAction
  | ClientSessionAction
  | ClientTerminalAction
  | ClientChangesetAction
  | ClientAnnotationsAction
  | ClientAutomationAction
  | ClientAutomationRunAction;
//# sourceMappingURL=reducer-helpers.d.ts.map

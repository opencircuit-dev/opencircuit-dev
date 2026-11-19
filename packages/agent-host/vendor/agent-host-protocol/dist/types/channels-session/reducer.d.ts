import type { SessionState } from "./state.js";
import type { SessionAction } from "../action-origin.generated.js";
/**
 * Pure reducer for session state. Handles all {@link SessionAction} variants.
 */
export declare function sessionReducer(
  state: SessionState,
  action: SessionAction,
  log?: (msg: string) => void,
): SessionState;
//# sourceMappingURL=reducer.d.ts.map

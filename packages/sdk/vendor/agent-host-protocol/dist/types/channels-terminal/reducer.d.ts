import type { TerminalState } from "./state.js";
import type { TerminalAction } from "../action-origin.generated.js";
/**
 * Pure reducer for terminal state. Handles all {@link TerminalAction} variants.
 */
export declare function terminalReducer(
  state: TerminalState,
  action: TerminalAction,
  log?: (msg: string) => void,
): TerminalState;
//# sourceMappingURL=reducer.d.ts.map

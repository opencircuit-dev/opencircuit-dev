import type { RootState } from "./state.js";
import type { RootAction } from "../action-origin.generated.js";
/**
 * Pure reducer for root state. Handles all {@link RootAction} variants.
 */
export declare function rootReducer(
  state: RootState,
  action: RootAction,
  log?: (msg: string) => void,
): RootState;
//# sourceMappingURL=reducer.d.ts.map

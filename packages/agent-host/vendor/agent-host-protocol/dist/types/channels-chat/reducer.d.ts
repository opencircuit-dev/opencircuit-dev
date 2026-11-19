import type { ChatState } from "./state.js";
import type { ChatAction } from "../action-origin.generated.js";
/**
 * Pure reducer for chat state. Handles all {@link ChatAction} variants.
 */
export declare function chatReducer(
  state: ChatState,
  action: ChatAction,
  log?: (msg: string) => void,
): ChatState;
//# sourceMappingURL=reducer.d.ts.map

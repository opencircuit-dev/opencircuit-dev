/**
 * Agent Host Protocol — Type Definitions
 *
 * @module agent-host-protocol
 * @description Canonical TypeScript type definitions for the Agent Host Protocol.
 * These types are the source of truth from which documentation and JSON Schema
 * are generated.
 */
export * from "./state.js";
export * from "./actions.js";
export * from "./action-origin.generated.js";
export * from "./window-exempt.generated.js";
export * from "./commands.js";
export * from "./notifications.js";
export * from "./messages.js";
export * from "./errors.js";
export * from "./version/registry.js";
export type { ChatAction } from "./action-origin.generated.js";
export {
  rootReducer,
  sessionReducer,
  chatReducer,
  canvasReducer,
  terminalReducer,
  changesetReducer,
  annotationsReducer,
  resourceWatchReducer,
  automationReducer,
  automationRunReducer,
  isClientDispatchable,
} from "./reducers.js";
//# sourceMappingURL=index.d.ts.map

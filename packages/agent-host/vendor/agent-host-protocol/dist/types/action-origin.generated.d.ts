import type {
  StateAction,
  RootAgentsChangedAction,
  RootActiveSessionsChangedAction,
  RootTerminalsChangedAction,
  RootConfigChangedAction,
  SessionReadyAction,
  SessionCreationFailedAction,
  SessionChatAddedAction,
  SessionChatRemovedAction,
  SessionChatUpdatedAction,
  SessionChatsReorderedAction,
  SessionDefaultChatChangedAction,
  SessionTitleChangedAction,
  SessionServerToolsChangedAction,
  SessionActiveClientSetAction,
  SessionActiveClientRemovedAction,
  SessionWorkingDirectorySetAction,
  SessionWorkingDirectoryRemovedAction,
  SessionWorkingDirectoryReplacedAction,
  SessionInputNeededSetAction,
  SessionInputNeededRemovedAction,
  SessionCustomizationsChangedAction,
  SessionCustomizationToggledAction,
  SessionCustomizationUpdatedAction,
  SessionCustomizationRemovedAction,
  SessionMcpServerStateChangedAction,
  SessionMcpServerStartRequestedAction,
  SessionMcpServerStopRequestedAction,
  SessionMcpServerBackgroundRequestedAction,
  SessionIsReadChangedAction,
  SessionIsArchivedChangedAction,
  SessionActivityChangedAction,
  SessionChangesetsChangedAction,
  SessionConfigChangedAction,
  SessionMetaChangedAction,
  ChatTurnStartedAction,
  ChatDeltaAction,
  ChatResponsePartAction,
  ChatToolCallStartAction,
  ChatToolCallDeltaAction,
  ChatToolCallReadyAction,
  ChatToolCallConfirmedAction,
  ChatToolCallCompleteAction,
  ChatToolCallResultConfirmedAction,
  ChatToolCallContentChangedAction,
  ChatToolCallAuthRequiredAction,
  ChatToolCallAuthResolvedAction,
  ChatTurnCompleteAction,
  ChatTurnCancelledAction,
  ChatErrorAction,
  ChatTurnResumeAction,
  ChatActivityChangedAction,
  ChatBackgroundWorkSetAction,
  ChatBackgroundWorkRemovedAction,
  ChatMovableChangedAction,
  ChatChangesetsChangedAction,
  ChatCanvasesChangedAction,
  CanvasStateChangedAction,
  ChatWorkingDirectorySetAction,
  ChatWorkingDirectoryRemovedAction,
  ChatUsageAction,
  ChatReasoningAction,
  ChatPendingMessageSetAction,
  ChatPendingMessageRemovedAction,
  ChatQueuedMessagesReorderedAction,
  ChatDraftChangedAction,
  ChatIsReadChangedAction,
  ChatIsArchivedChangedAction,
  ChatConfigChangedAction,
  ChatMovedAction,
  ChatInputRequestedAction,
  ChatInputAnswerChangedAction,
  ChatInputCompletedAction,
  ChatTruncatedAction,
  ChatTurnsLoadedAction,
  ChangesetStatusChangedAction,
  ChangesetFileSetAction,
  ChangesetFileRemovedAction,
  ChangesetFilesReviewChangedAction,
  ChangesetContentChangedAction,
  ChangesetOperationsChangedAction,
  ChangesetOperationStatusChangedAction,
  ChangesetClearedAction,
  AnnotationsSetAction,
  AnnotationsUpdatedAction,
  AnnotationsRemovedAction,
  AnnotationsEntrySetAction,
  AnnotationsEntryRemovedAction,
  TerminalDataAction,
  TerminalInputAction,
  TerminalResizedAction,
  TerminalClaimedAction,
  TerminalTitleChangedAction,
  TerminalCwdChangedAction,
  TerminalExitedAction,
  TerminalClearedAction,
  TerminalCommandDetectionAvailableAction,
  TerminalCommandExecutedAction,
  TerminalCommandFinishedAction,
  ResourceWatchChangedAction,
  AutomationCreateRequestedAction,
  AutomationUpdateRequestedAction,
  AutomationSetAction,
  AutomationRemovedAction,
  AutomationRunLifecycleChangedAction,
  AutomationRunSessionSetAction,
  AutomationRunSessionRemovedAction,
  AutomationRunPrimarySessionChangedAction,
  AutomationRunCancelRequestedAction,
} from "./actions.js";
/** Union of all root-scoped actions. */
export type RootAction =
  | RootAgentsChangedAction
  | RootActiveSessionsChangedAction
  | RootTerminalsChangedAction
  | RootConfigChangedAction;
/** Union of root actions that clients may dispatch. */
export type ClientRootAction = RootConfigChangedAction;
/** Union of root actions that only the server may produce. */
export type ServerRootAction =
  | RootAgentsChangedAction
  | RootActiveSessionsChangedAction
  | RootTerminalsChangedAction;
/** Union of all session-scoped actions. */
export type SessionAction =
  | SessionReadyAction
  | SessionCreationFailedAction
  | SessionChatAddedAction
  | SessionChatRemovedAction
  | SessionChatUpdatedAction
  | SessionChatsReorderedAction
  | SessionDefaultChatChangedAction
  | SessionTitleChangedAction
  | SessionServerToolsChangedAction
  | SessionActiveClientSetAction
  | SessionActiveClientRemovedAction
  | SessionWorkingDirectorySetAction
  | SessionWorkingDirectoryRemovedAction
  | SessionWorkingDirectoryReplacedAction
  | SessionInputNeededSetAction
  | SessionInputNeededRemovedAction
  | SessionCustomizationsChangedAction
  | SessionCustomizationToggledAction
  | SessionCustomizationUpdatedAction
  | SessionCustomizationRemovedAction
  | SessionMcpServerStateChangedAction
  | SessionMcpServerStartRequestedAction
  | SessionMcpServerStopRequestedAction
  | SessionMcpServerBackgroundRequestedAction
  | SessionIsReadChangedAction
  | SessionIsArchivedChangedAction
  | SessionActivityChangedAction
  | SessionChangesetsChangedAction
  | SessionConfigChangedAction
  | SessionMetaChangedAction;
/** Union of session actions that clients may dispatch. */
export type ClientSessionAction =
  | SessionTitleChangedAction
  | SessionActiveClientSetAction
  | SessionActiveClientRemovedAction
  | SessionWorkingDirectorySetAction
  | SessionWorkingDirectoryRemovedAction
  | SessionWorkingDirectoryReplacedAction
  | SessionCustomizationToggledAction
  | SessionMcpServerStartRequestedAction
  | SessionMcpServerStopRequestedAction
  | SessionMcpServerBackgroundRequestedAction
  | SessionIsReadChangedAction
  | SessionIsArchivedChangedAction
  | SessionConfigChangedAction;
/** Union of session actions that only the server may produce. */
export type ServerSessionAction =
  | SessionReadyAction
  | SessionCreationFailedAction
  | SessionChatAddedAction
  | SessionChatRemovedAction
  | SessionChatUpdatedAction
  | SessionChatsReorderedAction
  | SessionDefaultChatChangedAction
  | SessionServerToolsChangedAction
  | SessionInputNeededSetAction
  | SessionInputNeededRemovedAction
  | SessionCustomizationsChangedAction
  | SessionCustomizationUpdatedAction
  | SessionCustomizationRemovedAction
  | SessionMcpServerStateChangedAction
  | SessionActivityChangedAction
  | SessionChangesetsChangedAction
  | SessionMetaChangedAction;
/** Union of all chat-scoped actions. */
export type ChatAction =
  | ChatTurnStartedAction
  | ChatDeltaAction
  | ChatResponsePartAction
  | ChatToolCallStartAction
  | ChatToolCallDeltaAction
  | ChatToolCallReadyAction
  | ChatToolCallConfirmedAction
  | ChatToolCallCompleteAction
  | ChatToolCallResultConfirmedAction
  | ChatToolCallContentChangedAction
  | ChatToolCallAuthRequiredAction
  | ChatToolCallAuthResolvedAction
  | ChatTurnCompleteAction
  | ChatTurnCancelledAction
  | ChatErrorAction
  | ChatTurnResumeAction
  | ChatActivityChangedAction
  | ChatBackgroundWorkSetAction
  | ChatBackgroundWorkRemovedAction
  | ChatMovableChangedAction
  | ChatChangesetsChangedAction
  | ChatCanvasesChangedAction
  | ChatWorkingDirectorySetAction
  | ChatWorkingDirectoryRemovedAction
  | ChatUsageAction
  | ChatReasoningAction
  | ChatPendingMessageSetAction
  | ChatPendingMessageRemovedAction
  | ChatQueuedMessagesReorderedAction
  | ChatDraftChangedAction
  | ChatIsReadChangedAction
  | ChatIsArchivedChangedAction
  | ChatConfigChangedAction
  | ChatMovedAction
  | ChatInputRequestedAction
  | ChatInputAnswerChangedAction
  | ChatInputCompletedAction
  | ChatTruncatedAction
  | ChatTurnsLoadedAction;
/** Union of chat actions that clients may dispatch. */
export type ClientChatAction =
  | ChatTurnStartedAction
  | ChatToolCallConfirmedAction
  | ChatToolCallCompleteAction
  | ChatToolCallResultConfirmedAction
  | ChatToolCallContentChangedAction
  | ChatTurnCancelledAction
  | ChatTurnResumeAction
  | ChatWorkingDirectorySetAction
  | ChatWorkingDirectoryRemovedAction
  | ChatPendingMessageSetAction
  | ChatPendingMessageRemovedAction
  | ChatQueuedMessagesReorderedAction
  | ChatDraftChangedAction
  | ChatIsReadChangedAction
  | ChatIsArchivedChangedAction
  | ChatConfigChangedAction
  | ChatInputAnswerChangedAction
  | ChatInputCompletedAction
  | ChatTruncatedAction;
/** Union of chat actions that only the server may produce. */
export type ServerChatAction =
  | ChatDeltaAction
  | ChatResponsePartAction
  | ChatToolCallStartAction
  | ChatToolCallDeltaAction
  | ChatToolCallReadyAction
  | ChatToolCallAuthRequiredAction
  | ChatToolCallAuthResolvedAction
  | ChatTurnCompleteAction
  | ChatErrorAction
  | ChatActivityChangedAction
  | ChatBackgroundWorkSetAction
  | ChatBackgroundWorkRemovedAction
  | ChatMovableChangedAction
  | ChatChangesetsChangedAction
  | ChatCanvasesChangedAction
  | ChatUsageAction
  | ChatReasoningAction
  | ChatMovedAction
  | ChatInputRequestedAction
  | ChatTurnsLoadedAction;
/** Union of all canvas-scoped actions. */
export type CanvasAction = CanvasStateChangedAction;
/** Union of canvas actions that clients may dispatch. */
export type ClientCanvasAction = never;
/** Union of canvas actions that only the server may produce. */
export type ServerCanvasAction = CanvasStateChangedAction;
/** Union of all terminal-scoped actions. */
export type TerminalAction =
  | TerminalDataAction
  | TerminalInputAction
  | TerminalResizedAction
  | TerminalClaimedAction
  | TerminalTitleChangedAction
  | TerminalCwdChangedAction
  | TerminalExitedAction
  | TerminalClearedAction
  | TerminalCommandDetectionAvailableAction
  | TerminalCommandExecutedAction
  | TerminalCommandFinishedAction;
/** Union of terminal actions that clients may dispatch. */
export type ClientTerminalAction =
  | TerminalInputAction
  | TerminalResizedAction
  | TerminalClaimedAction
  | TerminalTitleChangedAction
  | TerminalClearedAction;
/** Union of terminal actions that only the server may produce. */
export type ServerTerminalAction =
  | TerminalDataAction
  | TerminalCwdChangedAction
  | TerminalExitedAction
  | TerminalCommandDetectionAvailableAction
  | TerminalCommandExecutedAction
  | TerminalCommandFinishedAction;
/** Union of all changeset-scoped actions. */
export type ChangesetAction =
  | ChangesetStatusChangedAction
  | ChangesetFileSetAction
  | ChangesetFileRemovedAction
  | ChangesetFilesReviewChangedAction
  | ChangesetContentChangedAction
  | ChangesetOperationsChangedAction
  | ChangesetOperationStatusChangedAction
  | ChangesetClearedAction;
/** Union of changeset actions that clients may dispatch. */
export type ClientChangesetAction = ChangesetFilesReviewChangedAction;
/** Union of changeset actions that only the server may produce. */
export type ServerChangesetAction =
  | ChangesetStatusChangedAction
  | ChangesetFileSetAction
  | ChangesetFileRemovedAction
  | ChangesetContentChangedAction
  | ChangesetOperationsChangedAction
  | ChangesetOperationStatusChangedAction
  | ChangesetClearedAction;
/** Union of all annotations-scoped actions. */
export type AnnotationsAction =
  | AnnotationsSetAction
  | AnnotationsUpdatedAction
  | AnnotationsRemovedAction
  | AnnotationsEntrySetAction
  | AnnotationsEntryRemovedAction;
/** Union of annotations actions that clients may dispatch. */
export type ClientAnnotationsAction =
  | AnnotationsSetAction
  | AnnotationsUpdatedAction
  | AnnotationsRemovedAction
  | AnnotationsEntrySetAction
  | AnnotationsEntryRemovedAction;
/** Union of annotations actions that only the server may produce. */
export type ServerAnnotationsAction = never;
/** Union of all resource-watch-scoped actions. */
export type ResourceWatchAction = ResourceWatchChangedAction;
/** Union of resource-watch actions that clients may dispatch. */
export type ClientResourceWatchAction = never;
/** Union of resource-watch actions that only the server may produce. */
export type ServerResourceWatchAction = ResourceWatchChangedAction;
/** Union of all automation-scoped actions. */
export type AutomationAction =
  | AutomationCreateRequestedAction
  | AutomationUpdateRequestedAction
  | AutomationSetAction
  | AutomationRemovedAction;
/** Union of automation actions that clients may dispatch. */
export type ClientAutomationAction =
  | AutomationCreateRequestedAction
  | AutomationUpdateRequestedAction
  | AutomationRemovedAction;
/** Union of automation actions that only the server may produce. */
export type ServerAutomationAction = AutomationSetAction;
/** Union of all automation-run-scoped actions. */
export type AutomationRunAction =
  | AutomationRunLifecycleChangedAction
  | AutomationRunSessionSetAction
  | AutomationRunSessionRemovedAction
  | AutomationRunPrimarySessionChangedAction
  | AutomationRunCancelRequestedAction;
/** Union of automation-run actions that clients may dispatch. */
export type ClientAutomationRunAction = AutomationRunCancelRequestedAction;
/** Union of automation-run actions that only the server may produce. */
export type ServerAutomationRunAction =
  | AutomationRunLifecycleChangedAction
  | AutomationRunSessionSetAction
  | AutomationRunSessionRemovedAction
  | AutomationRunPrimarySessionChangedAction;
/**
 * Exhaustive map indicating which action types may be dispatched by clients.
 * Adding a new action to StateAction without adding it here is a compile error.
 */
export declare const IS_CLIENT_DISPATCHABLE: {
  readonly [K in StateAction["type"]]: boolean;
};
//# sourceMappingURL=action-origin.generated.d.ts.map

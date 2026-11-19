import type { ChangesetState } from "./state.js";
import type { ChangesetAction } from "../action-origin.generated.js";
/**
 * Pure reducer for changeset state. Handles all {@link ChangesetAction}
 * variants.
 *
 * The reducer preserves a stable file order by appending new files via
 * {@link ActionType.ChangesetFileSet} when the id is unknown, and replacing in
 * place when it matches an existing entry. Per-file review lives on
 * {@link ChangesetFile.reviewed} and is toggled (per file, in batches) by the
 * client-dispatchable {@link ActionType.ChangesetFilesReviewChanged}.
 */
export declare function changesetReducer(
  state: ChangesetState,
  action: ChangesetAction,
  log?: (msg: string) => void,
): ChangesetState;
//# sourceMappingURL=reducer.d.ts.map

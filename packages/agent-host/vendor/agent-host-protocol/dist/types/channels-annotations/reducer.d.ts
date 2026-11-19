import type { AnnotationsState } from "./state.js";
import type { AnnotationsAction } from "../action-origin.generated.js";
/**
 * Pure reducer for annotations state. Handles every {@link AnnotationsAction}
 * variant.
 *
 * Per the spec, every annotations action is client-dispatchable; the reducer
 * runs identically on the client (optimistic, write-ahead) and the server. It
 * preserves the dispatch order of annotations (and of entries within an
 * annotation): new entries are appended; `*Set` actions with a matching id
 * replace in place, while actions whose target id is unknown are no-ops
 * (mirroring `changeset/fileRemoved` semantics). The single-entry
 * minimum invariant is enforced by producers, not the reducer — removing an
 * annotation's last entry via {@link AnnotationsEntryRemovedAction} (instead
 * of {@link AnnotationsRemovedAction}) would leave an empty annotation,
 * which is observable but not catastrophic.
 */
export declare function annotationsReducer(
  state: AnnotationsState,
  action: AnnotationsAction,
  log?: (msg: string) => void,
): AnnotationsState;
//# sourceMappingURL=reducer.d.ts.map

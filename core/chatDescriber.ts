// Stable facade for the CLI-Core chat-describer contract (Phase 3, Item 4).
//
// This re-exports the existing implementation in `util/chatDescriber.ts`
// under a root-relative path so it can be consumed as a durable subpath
// (`@opencircuit/core/chatDescriber`) without requiring a package.json
// `exports` map yet. See docs/reduction/artifacts/phase3/item2-evidence.md
// for the approved API proposal and
// docs/reduction/artifacts/phase3/item4-errors-group.md for the migration
// process (and the explicit-extension convention) this file follows.
export * from "./util/chatDescriber.js";

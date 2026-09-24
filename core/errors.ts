// Stable facade for the CLI-Core error contract (Phase 3, Item 4).
//
// This re-exports the existing implementation in `util/errors.ts` under a
// root-relative path so it can be consumed as a durable subpath
// (`@opencircuit/core/errors`) without requiring a package.json `exports`
// map yet. See docs/reduction/artifacts/phase3/item2-evidence.md for the
// approved API proposal and docs/planning/phase3-core-boundary_v1.md
// ("Item 4") for the migration process this file is part of.
export * from "./util/errors.js";

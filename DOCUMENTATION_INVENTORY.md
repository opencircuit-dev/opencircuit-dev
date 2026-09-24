# Documentation and utility inventory

## Documentation placement

| Surface                                       | Canonical location                                                         | Status                 |
| --------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| User install, provider setup, troubleshooting | Root `QUICKSTART.md` and `FAQ.md`                                          | Canonical              |
| Contributor and repository policy             | Root `CONTRIBUTING.md`, `TESTING.md`, `LARGE_FILES.md`                     | Canonical              |
| CLI reference and behavior contracts          | `extensions/cli/README.md`, `extensions/cli/spec/`, `extensions/cli/docs/` | Canonical              |
| Core subsystem implementation notes           | Colocated `core/<subsystem>/README.md` or spec                             | Intentional colocation |
| Package API/release notes                     | Owning package README/CHANGELOG                                            | Canonical              |
| Test architecture and cross-package checks    | Root `TESTING.md`                                                          | Canonical              |

Colocated source documentation is retained only where it explains a module's
implementation or operational contract. Cross-surface guidance belongs in the
root guides or the owning surface's `docs/`/`spec/` directory.

## Utility naming adoption

The repository uses `utils/` for utility directories and focused singular
modules such as `paths.ts`, `errors.ts`, and `uri.ts`. Existing generic
`util/` directories are preserved to avoid unrelated import-path churn.

New utility code must use a behavior-specific module name. The next cohesive
migration target is the CLI's `src/util/metadata.ts` and adjacent metadata
callers; migration is intentionally deferred until an import-path change is
needed for product work.

# Runtime asset ownership

This inventory records the ownership and distribution decision for the
large/runtime assets relevant to the prototype CLI/Core boundary.

| Asset                                       | Runtime consumer                          | Source/provenance                                                                                       | Distribution decision                                                                                   |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `core/vendor/tree-sitter.wasm`              | Core tree-sitter parsing/indexing runtime | Vendored runtime asset required by the Core parser path                                                 | Keep versioned with Core; clean-build and runtime-boundary checks must continue to load it              |
| `core/vendor/modules/@xenova/transformers/` | Vendored Transformers.js runtime          | Vendored dependency retained to avoid the unused `sharp` native dependency; see `core/vendor/README.md` | Keep package-owned and outside the root dependency boundary; update only with dependency/license review |

## Review requirements

These assets are deliberate exceptions to the default large-file policy in
`LARGE_FILES.md`. They must not be duplicated in release artifacts or moved
between retained CLI/Core components without evidence from source references,
bundle/package contents, and controlled runtime checks.

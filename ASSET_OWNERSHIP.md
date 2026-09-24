# Runtime asset ownership

This inventory records the ownership and distribution decision for the
large/runtime assets relevant to the prototype CLI/Core boundary.

| Asset                                                                 | Runtime consumer                          | Source/provenance                                                                                                   | Distribution decision                                                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions/vscode/models/all-MiniLM-L6-v2/`                          | VS Code local embedding flow              | `sentence-transformers/all-MiniLM-L6-v2`, converted/published as ONNX for Transformers.js; see the colocated README | Keep as a deferred VS Code asset. It is not part of the retained CLI release; changes require model license/provenance review and VS Code packaging validation |
| `extensions/vscode/models/all-MiniLM-L6-v2/onnx/model_quantized.onnx` | VS Code Transformers.js embedding runtime | Quantized ONNX model from the documented Hugging Face model family                                                  | Keep versioned with the VS Code model directory while that surface is supported; do not copy into CLI/Core artifacts                                           |
| `core/vendor/tree-sitter.wasm`                                        | Core tree-sitter parsing/indexing runtime | Vendored runtime asset required by the Core parser path                                                             | Keep versioned with Core; clean-build and runtime-boundary checks must continue to load it                                                                     |
| `core/vendor/modules/@xenova/transformers/`                           | Vendored Transformers.js runtime          | Vendored dependency retained to avoid the unused `sharp` native dependency; see `core/vendor/README.md`             | Keep package-owned and outside the root dependency boundary; update only with dependency/license review                                                        |

## Review requirements

These assets are deliberate exceptions to the default large-file policy in
`LARGE_FILES.md`. They must not be duplicated in release artifacts or moved
between CLI/Core and deferred VS Code surfaces without evidence from source
references, bundle/package contents, and controlled runtime checks.

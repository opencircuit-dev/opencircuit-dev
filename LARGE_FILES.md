# Large-file contribution policy

Large generated files and model assets can make clones, reviews, releases, and
CI substantially slower. Keep them out of source control unless the runtime
cannot work without a versioned asset and the ownership is explicit.

## Default policy

- Do not commit downloaded model weights, tokenizer caches, embeddings, build
  output, release tarballs, logs, or local databases.
- Prefer a package download step, an existing dependency, or a release asset
  with a checksum.
- Keep fixtures small and purpose-built. A fixture should prove behavior, not
  reproduce a production model or repository.
- Do not add a large file merely to make a test convenient; document the
  smaller deterministic substitute or the download path instead.

## Required review for an exception

Before adding a file larger than 1 MiB, or a directory containing model/tokenizer
assets, document in the pull request:

1. Why the asset must be versioned rather than downloaded or generated.
2. Which package owns it and which runtime path consumes it.
3. Its license, provenance, and update owner.
4. Its expected size and whether it is included in published artifacts.
5. How CI and contributors can validate it without leaking credentials.

Maintainers should also update `.gitignore`, the owning package README, and the
release/retained-closure checks when the asset changes packaging behavior.

The checked-in tokenizer and model-related files under `core/` and
`extensions/vscode/models/` are therefore treated as deliberate exceptions:
changes require ownership and packaging evidence, not a blanket asset copy.

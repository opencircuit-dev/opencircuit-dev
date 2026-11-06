# Core indexing

The indexing subsystem turns repository files into reusable search artifacts.
The index catalog and refresh coordination live in `CodebaseIndexer.ts` and
`refreshIndex.ts`; index implementations provide artifact-specific updates
and progress.

## Index implementations

`getIndexesToBuild()` on `CodebaseIndexer` determines which implementations
participate. The current indexes include:

- `CodeSnippetsCodebaseIndex` for structural code symbols.
- `FullTextSearchCodebaseIndex` for SQLite FTS5 search.
- `ChunkCodebaseIndex` for structure-aware text chunks.
- `LanceDbIndex` for embedding and vector search.

Index implementations share the `CodebaseIndex` contract in `types.ts`.
Refresh logic tracks file changes and reuses cached work where its cache keys
allow; index-specific storage and branch/repository scoping remain the
responsibility of each implementation.

When changing indexing behavior, update or add focused tests alongside the
affected implementation and verify refresh/progress behavior as well as query
results.

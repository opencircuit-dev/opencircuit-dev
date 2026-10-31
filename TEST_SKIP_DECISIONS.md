# Deferred test decisions

This file is the current index of skipped tests in the retained CLI/Core
surface. Skipped tests are not passing tests. Do not enable credentialed or
external-infrastructure tests in the deterministic baseline.

## Current deferrals

| Tests                                                                                                                                                                                                        | Reason and re-enable condition                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/edit/lazy/deterministic.test.ts`: `calculator docstrings`, `calculator stateless`, `gui add toggle`, and `should handle case where surrounding class is neglected, with lazy block surrounding`        | These cases exercise known limits in structural alignment and diff rejection heuristics. The adjacent TODO comments describe each limit; revisit with algorithm-level tests and regression review. |
| `core/indexing/CodeSnippetsIndex.test.ts`, `core/indexing/FullTextSearchCodebaseIndex.test.ts`, `core/indexing/LanceDbIndex.test.skip.ts`, and `core/indexing/chunk/{basic,code,ChunkCodebaseIndex}.test.ts` | Deferred indexing implementations; re-enable when the owning implementation has deterministic fixtures and a maintained test owner.                                                                |
| `core/indexing/docs/DocsService.skip.ts` and `core/indexing/docs/crawlers/DocsCrawler.test.ts`                                                                                                               | External crawling/browser integration; re-enable with local HTTP fixtures and a pinned browser fixture.                                                                                            |
| `core/context/mcp/MCPConnection.vitest.ts` filesystem connection case                                                                                                                                        | External MCP server integration; re-enable with a loopback MCP fixture.                                                                                                                            |
| `extensions/cli/src/smoke-api/*.test.ts`, `packages/openai-adapters/src/test/*live*`, and provider/API-key comparison tests                                                                                  | Credentialed provider tests; run only in the provider integration workflow with injected CI secrets.                                                                                               |
| `extensions/cli/src/commands/serve.test.ts` `/exit` endpoint stub                                                                                                                                            | The route is defined inside `serve()`; re-enable once the app can be constructed independently of full service bootstrap or a lightweight service-bootstrap harness exists.                        |

## History

Resolved-test investigations and prior validation snapshots are recorded in
the forum's `prototype-updates_v1.md` and `prototype-updates_v2.md`. Those
historical results do not qualify the current source checkout.

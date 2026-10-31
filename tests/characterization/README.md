# Retained-closure characterization

These checks preserve selected CLI/Core contracts during changes to package
boundaries, declarations, workspace configuration, and runtime resolution.
They reuse existing tests where those already provide deterministic coverage.

| Contract                                  | Test or check                                              | Network mode                          |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Configuration parsing                     | `packages/config-yaml/src/__tests__/index.test.ts`         | In-memory registry and local fixtures |
| Core initialization and adapter selection | `extensions/cli/src/services/ModelService.test.ts`         | Mocked API factory                    |
| Controlled non-editor workflow            | `extensions/cli/src/e2e/headless-mock-llm.test.ts`         | Local HTTP fixture                    |
| Adapter normalization                     | `packages/openai-adapters/src/apis/Anthropic.test.ts`      | No network                            |
| CLI invocation                            | `extensions/cli/smoke-test.mjs` and the headless mock test | No network or local HTTP fixture      |
| Core public import                        | Export-state inventory; unavailable at baseline            | Not applicable                        |
| Static and emitted boundary               | `node tests/characterization/boundary-check.mjs`           | No network                            |
| Runtime boundary                          | `node tests/characterization/runtime-boundary-check.mjs`   | No network                            |
| Retired VS Code surfaces                  | `npm run test:retired-surface-guard`                       | No network                            |

Run the retained-closure profile from the repository root with:

```bash
npm run validate:retained-closure
```

The boundary checks treat existing CLI-to-Core deep imports as observed
baseline evidence. They fail when Core or the emitted/runtime CLI closure
crosses a prohibited repository boundary.

The runtime boundary check is the hermetic CLI-to-Core functional gate. It
expects build artifacts to be present, starts a loopback-only mock
OpenAI-compatible server, invokes the emitted CLI with an isolated temporary
home/configuration, checks the request and streamed response, and verifies
that bundle metadata contains Core inputs. It does not use provider
credentials or external network access.

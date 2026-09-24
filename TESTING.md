# Test architecture

Open Circuit uses several test layers. Choose the narrowest layer that proves
the behavior you changed, then run the retained-closure checks when a change
crosses package or runtime boundaries.

## Test layers

| Layer                | Location                                                                     | Use it for                                                       | Command                                             |
| -------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| Unit and service     | `core/**/*.test.ts`, `core/**/*.vitest.ts`, `extensions/cli/src/**/*.test.*` | Pure logic, services, configuration, and error handling          | `npm test` in the owning package                    |
| UI                   | `extensions/cli/src/ui/**/*.test.*`                                          | Ink rendering, keyboard input, and user-visible state            | `npm test -- --run <file>` in `extensions/cli`      |
| CLI end-to-end       | `extensions/cli/src/e2e/`                                                    | Complete command-line flows and configuration switching          | `npm run test:e2e` in `extensions/cli`              |
| Smoke                | `extensions/cli/smoke-test.mjs`                                              | Built CLI startup, help, version, and packaging assumptions      | `npm run test:smoke` in `extensions/cli`            |
| Runtime boundary     | `tests/characterization/`                                                    | CLI-to-Core loading and retained package boundaries              | `npm run test:runtime-boundary` in `extensions/cli` |
| Provider integration | `core/llm/` and provider integration tests                                   | Real provider behavior; requires credentials and explicit opt-in | `npm run test:providers` in `core`                  |

Core currently retains both Jest and Vitest suites. Do not convert a test
framework as part of a behavior change; follow the runner used by neighboring
tests and the owning package configuration.

## Test placement

- Keep a unit test beside the implementation when the behavior is local.
- Put shared test fixtures and service factories under the package's
  `test-helpers/` or `test/` directory.
- Put user workflows that cross command, configuration, and session boundaries
  under `extensions/cli/src/e2e/` or `integration/`.
- Keep generated assets, downloaded models, and release artifacts out of test
  fixtures unless the test explicitly verifies packaging or asset loading.

## Change-to-test guide

- Pure function or parser: add a focused unit test, including invalid input.
- CLI output or exit behavior: add a CLI test and, when it affects the built
  artifact, run the smoke test.
- Configuration or package ownership: add a boundary or integration check and
  run `validate:retained-closure`.
- UI behavior: assert visible output and interaction, not private component
  implementation details.
- Provider behavior: use mocks for ordinary tests; reserve credentialed tests
  for the provider integration suite.

## Local validation

From `extensions/cli`:

```bash
npm run typecheck
npm test -- --run <focused-test-file>
npm run test:smoke
```

From `core`:

```bash
npm run tsc:check
npm test -- --runInBand <focused-test-file>
```

For package-boundary, declaration, workspace, or runtime-resolution changes,
run this from the repository root:

```bash
npm run validate:retained-closure
```

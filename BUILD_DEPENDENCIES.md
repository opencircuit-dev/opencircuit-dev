# Build Dependencies and CI Secrets

This document catalogs CI secrets and environment variables used by Open
Circuit's retained CLI/Core repository and deferred VS Code workflows.

## Retained-closure validation

Run the complete deterministic profile from the repository root on Ubuntu1 or
another Linux runner:

    npm run validate:retained-closure

The profile installs from lockfiles, builds shared packages and Core, checks
the exact install-script and dependency policies, audits Core and CLI, runs
the CLI smoke and hermetic CLI-to-Core runtime tests, validates the dry-run
CLI package artifact, and runs Rust format/check/tests/benchmark/audit. Use
npm run validate:retained-closure -- --skip-install only after dependencies
have already been installed from the current lockfiles.

## Runtime

- Node.js `24.19.0`, pinned by `.nvmrc` and `.node-version`.
- npm with the committed package lockfiles.
- Rust/Cargo 1.98.1 and cargo-audit for the sync retained-closure gate.

## CI and release secrets

Secrets are supplied by the CI environment and must never be committed:

- `GITHUB_TOKEN`, `CI_GITHUB_TOKEN`
- `SEMANTIC_RELEASE_GITHUB_TOKEN`, `SEMANTIC_RELEASE_NPM_TOKEN`,
  `SEMANTIC_RELEASE_TOKEN`
- `VSCE_TOKEN`, `VSX_REGISTRY_TOKEN`
- `SNYK_TOKEN`, `RUNLOOP_API_KEY`
- `GH_ACTIONS_SSH_TEST_KEY_PEM`, `GH_ACTIONS_SSH_TEST_DNS_NAME`
- `CHROMA_CLOUD_API_KEY`, `CHROMA_TENANT`, `CHROMA_DATABASE`
- `ISSUE_PR_METRICS_SLACK_WEBHOOK_URL`

## Provider and platform variables

Provider API keys used by integration tests are configured only in CI or local
secret stores:

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`MISTRAL_API_KEY`, `AZURE_OPENAI_API_KEY`,
`AZURE_FOUNDRY_CODESTRAL_API_KEY`, `AZURE_FOUNDRY_MISTRAL_SMALL_API_KEY`,
`AZURE_OPENAI_GPT41_API_KEY`, `VOYAGE_API_KEY`, `RELACE_API_KEY`,
`INCEPTION_API_KEY`.

Compatibility-preserved Open Circuit variables include:

- `OCIRCUIT_API_BASE`
- `OCIRCUIT_API_KEY`

Their historical names are package and workflow contracts and must not be
renamed as a documentation-only change.

## References

Workflow files are under `.github/workflows/`. The CLI environment example is
`extensions/cli/.env.example`. Never place real secret values in either file.

# Build Dependencies and CI Secrets

This document catalogs CI secrets and environment variables used by Open
Circuit's retained CLI/Core repository.

## Retained-closure validation

Run the complete deterministic profile from the repository root on Ubuntu1 or
another Linux runner:

    npm run validate:retained-closure

The profile installs from lockfiles, builds shared packages and Core, checks
the exact install-script and dependency policies, audits Core and CLI, runs
the CLI smoke and hermetic CLI-to-Core runtime tests, validates the dry-run
CLI package artifact. Use npm run validate:retained-closure -- --skip-install
only after dependencies have already been installed from the current lockfiles.

## Runtime

- Node.js `24.19.0`, pinned by `.nvmrc` and `.node-version`.
- npm with the committed package lockfiles.

## Dependency remediation and release planning

The retained schemas use Zod 4.6.7 and native draft-7 JSON schema generation.
OpenAI is pinned to 6.0.0, whose published types retain the existing Responses
audio-input contract; newer SDK versions require a separate compatibility
review. Puppeteer 25.16.0 removes the old Zod 3 browser dependency, and its
browser-download install hook has an exact-version approval. Happy DOM 21.0.4
and Vitest 5.0.5 update the CLI test environment.

The reusable release workflow calls `scripts/release-package.mjs --execute`
instead of semantic-release. From a retained package directory, run
`node ../../scripts/release-package.mjs --dry-run` to inspect the proposed
version, package-specific tag, and changelog without publishing. CLI
`semantic-release` npm script names remain compatibility aliases. Publishing
requires a clean main checkout in the canonical public GitHub Actions
repository and environment-supplied credentials; source branches are not pushed.

The Core deprecation baseline removes the retired jsdom warning chain and
records the newly reported warning for the already-present
`babel-plugin-istanbul` -> `test-exclude@7` -> `glob@10.5.0` chain. The expiry
is unchanged; this warning record is not a vulnerability exception.

The deprecated generic `database` context provider and its `dbinfoz` ->
`mssql` -> `tedious` -> Azure Identity/MSAL dependency chain are removed.
Existing `database` entries are explicitly skipped with a configuration
warning; use a database MCP server instead. The separate `postgres` provider,
local SQLite storage, and Azure OpenAI remain available. Dependency policy
rejects reintroducing the retired chain; no audit finding is suppressed.
See `CI_RELEASE_AUDIT.md` for the audit policy.
Rollback must revert the migration commit with all affected manifests,
lockfiles, schema changes, and release scripts together, then reinstall and
rebuild; it restores the prior advisories and is not an audit remediation.

## CI and release secrets

Secrets are supplied by the CI environment and must never be committed:

- `GITHUB_TOKEN`, `CI_GITHUB_TOKEN`
- `SEMANTIC_RELEASE_GITHUB_TOKEN`, `SEMANTIC_RELEASE_NPM_TOKEN`,
  `SEMANTIC_RELEASE_TOKEN`
- `SNYK_TOKEN`, `RUNLOOP_API_KEY`
- `PUBLIC_RELEASE_REPO_TOKEN` (a PAT with `contents: write` on
  `opencircuit-dev/opencircuit`, used by `stable-release.yml` to publish
  packaged CLI release artifacts to that public repository)
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

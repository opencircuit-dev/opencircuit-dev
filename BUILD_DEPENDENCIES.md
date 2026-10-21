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

## Core dependency compatibility

Core removes its remaining sprintf-js chains with exact, parent-scoped
overrides: `@istanbuljs/load-nyc-config` uses `js-yaml@4.3.2`, and `dbinfoz`
uses `mssql@12.7.9` (which resolves tedious 20). The coverage loader uses the
retained `load` API, and the database adapter retains the ConnectionPool,
request, input, and query interfaces. No global YAML or SQL-driver override
is applied, and no audit acceptance is added.

Run `npm --prefix core run test:dependency-upgrades` to check YAML/extended
coverage configuration, mocked schema queries through the real upgraded SQL
driver, and absence of sprintf-js in the Core lockfile. This test does not
contact a database and does not certify live SQL Server connectivity. It is
part of the retained-closure profile, whose Core audit now rejects findings
at any severity. Remove these compatibility overrides when the owning
packages declare supported dependency ranges that remove the old chains.

## Release tooling

Release planning uses pinned conventional-changelog libraries, not
semantic-release or a bundled npm. Root and CLI development closures must
pass a zero-findings audit, including optional dependencies. The historical
`scripts/check-release-tooling-audit-exception.mjs` filename is retained for
command compatibility, but it no longer accepts exceptions.

From a retained package directory, preview the next version, package-scoped
tag, and changelog without changing files or contacting a registry:

node ../../scripts/release-package.mjs --dry-run

The CLI also exposes `npm run release:dry-run`; its historical
`semantic-release` script names remain aliases, not dependencies. Live
execution requires `--execute`, GitHub Actions on a clean `main` checkout,
the canonical public repository/origin pair, and existing GitHub/npm credentials.
The shared-package workflow supplies npm registry authentication. Existing
secret names are retained for compatibility.

Public npm publishing is disabled for the Cisco-internal fork at both the
workflow and command boundary. Internal tarball publication continues through
the separate internal release workflow, which is not changed here.

The command preserves shared-package scoped tags and CLI `v` tags and bump
rules. If no matching tag exists, the first release uses the checked-in
package version. It updates the package version and changelog, rebuilds,
publishes with lifecycle hooks disabled, pushes only the release tag, and
creates the GitHub release. It never commits or pushes generated changes to
`main`. No release is performed by validation tests.

Publishing spans npm and GitHub and is not transactional. If npm succeeds
but the tag or GitHub release fails, recover that same version explicitly;
do not bump and publish again to hide a partial release. Review the package
registry, source SHA, tag, and release state before recovery.

Run `node --test tests/characterization/release-package.test.mjs` to validate
release rules, dry-run immutability, publication guards, and the mocked
tag-only publishing flow. This check is also in the retained-closure profile.

## Runtime

- Node.js `24.19.0`, pinned by `.nvmrc` and `.node-version`.
- npm with the committed package lockfiles.

## CI and release secrets

Secrets are supplied by the CI environment and must never be committed:

- `GITHUB_TOKEN`, `CI_GITHUB_TOKEN`
- `SEMANTIC_RELEASE_GITHUB_TOKEN`, `SEMANTIC_RELEASE_NPM_TOKEN`,
  `SEMANTIC_RELEASE_TOKEN`
- `INTERNAL_RELEASE_REPO_TOKEN` (contents-write access to
  `opencircuit-dev/opencircuit-internal`)
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

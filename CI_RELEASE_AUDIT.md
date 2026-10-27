# CI and release reference audit

Canonical repository: `open-circuit-dev/open-circuit`

## Retained references

- Root README and CLI package metadata use the canonical repository and issue
  URLs.
- CLI release scripts produce `opencircuit-cli-<version>.tgz` and its
  `.sha256` file under the ignored `release-artifacts/` staging directory.
- Root and CLI docs consistently require Node.js `24.19.0`.
- Retained CLI/Core checks are documented as typecheck, build, smoke, and
  characterization/runtime-boundary validation.
- Clean dependency installs run through a pinned, expiring deprecation policy
  at `scripts/deprecation-allowlist.json`. It records only the currently
  reproduced upstream warnings and fails on any new, removed, or changed
  warning. The listed chains are tracked for direct-parent upgrades; major
  Jest, SQLite/native-build, ESLint, and fetch-stack changes require separate
  compatibility validation.
- Root, Core, and CLI production closures retain strict high-severity audit
  gates.
  Development-only release tooling is checked by a fail-closed zero-finding
  gate in `scripts/check-release-tooling-audit-exception.mjs` (the historical
  entry-point name is preserved). There are no vulnerability exceptions.
  Conventional changelog/recommendation libraries and the host npm CLI replace
  semantic-release's vulnerable bundled npm dependency.

## Deferred references

- Standalone VS Code extension and VSIX release workflows have been retired.
- Binary packaging remains a separate product surface.
- Credentialed provider workflows remain opt-in and are not part of the
  deterministic default validation path.

## Reference policy

Repository-owned links must use `https://github.com/open-circuit-dev/open-circuit`
or its `/issues`, `/discussions`, and `/blob/main/...` descendants. Third-party
links in workflow comments and dependency metadata are not project references.

Release artifacts are generated and uploaded from the release workflow; they
are not committed to `opencircuit-dev`. `stable-release.yml` builds the
`.tgz`/`.sha256` pair and pushes it to the public
`opencircuit-dev/opencircuit` repository via
`scripts/publish-release-artifacts.sh` (in this repository), gated by the
`PUBLIC_RELEASE_REPO_TOKEN`
secret. Checksum verification remains mandatory for the packaged user install
path.

## Validation evidence

The deprecated generic `database` context provider was the only consumer of
`dbinfoz`, which eagerly imported `mssql` -> `tedious` -> `@azure/identity` ->
`@azure/msal-node`. That provider and dependency chain have been removed rather
than bypassing GHSA-xcx6-jx8p-x3h5 or forcing an incompatible MSAL major version.
An existing `database` configuration now produces an explicit nonfatal
validation warning directing users to database MCP servers.

The Core dependency policy rejects reintroduction of these retired packages,
including nested lockfile entries. The separate `postgres` context provider,
local SQLite storage, and Azure OpenAI provider are unchanged.

Validation uses macOS, Node `24.19.0`, and npm `12.0.2`; full root, Core, and CLI
audits must report zero findings. Credentialed provider calls and real browser
crawling are not part of this deterministic profile.

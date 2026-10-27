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

The dependency remediation was validated on macOS with Node `24.19.0` and
npm `12.0.2`. Root and CLI full audits report zero vulnerabilities. The exact
retained-closure profile passes root installs/audits, release-planning tests,
shared builds, and Core installs/policies, then stops at the Core audit.

The remaining blocker is `tedious@18.6.2` -> `@azure/identity@4.14.0` ->
`@azure/msal-node@6.0.1`: GHSA-xcx6-jx8p-x3h5 affects MSAL 5 through 7.0.2.
MSAL 7.1.1 is fixed, but Identity's latest stable release requires `^6.0.0`,
and its current beta retains that requirement. Do not force MSAL 7 through an
unsupported major-version override. The older Identity 4.12/MSAL 3 lineage
also retains a vulnerable uuid dependency, so it is not an audit-clean fallback.
A supported parent release or separately reviewed Azure authentication
migration is required before this gate can pass.

Core build/typecheck/lint, OpenAI/YAML tests, CLI build/typecheck/lint, smoke,
runtime-boundary, artifact, and unit tests were run independently of that
fail-fast audit. Passing those checks does not make the full profile green.
Credentialed Azure/SQL and provider tests, Linux validation, and real browser
downloads are not claimed.

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
- Root, Core, and CLI dependency closures are audited with no
  exceptions. The historical check-release-tooling-audit-exception script
  name remains compatible, but any finding now fails the check. The former
  npm-bundle exception file has been removed with the dependency chain.

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

PR #5 imports upstream `1e9967945023cea8e2e7fc4630771b5640a9e969`
into internal baseline `50163baeeae70d9d6eff9ad57893d9c0d6fdf785`.
Local checks use Node.js `24.19.0`, npm `11.17.0`, and macOS arm64.
The complete retained-closure profile also passes on Server1 Linux at
`7f0e8ddee3cd1f30b89124824b1885e5b4007bf0` using Node.js `24.19.0`
and pinned Rust/Cargo `1.99.0`.

- Replacing config-yaml's Jest 29 runner with Vitest retains 288 passing
  source tests; emitted dist tests are not executed a second time. Unused
  adapter Jest tooling is removed; its Vitest suite retains 152 passing tests
  and its existing opt-in skips.
- Semantic-release and its plugins are removed from the five shared
  packages and CLI. Pinned conventional-changelog libraries plus standard
  Git/npm/GitHub CLI commands preserve release planning, notes, package tags,
  and npm/GitHub publication. No credentialed release was performed. See
  BUILD_DEPENDENCIES.md for the guarded execution and recovery contract.
- Root and CLI development/optional audits report zero vulnerabilities.
  Their lockfiles contain no braces, sprintf-js, bundled npm, or
  semantic-release packages. Previously, the same-registry baseline root
  audit reported 52 affected package entries, and the initial sync reported 48. Counts include transitive metavulnerabilities, not distinct advisories;
  registry metadata can change independently of the lockfile.
- The exact root deprecation baseline falls from three warnings to one:
  inflight and old glob disappear with shared Jest ownership. Core retains
  14 reviewed warnings, including glob 10 through coverage tooling, and the
  exact-version reviewed watcher hook approval. The existing deprecation
  expiry is unchanged; warning entries are not vulnerability exceptions.
- Core's full audit now reports zero vulnerabilities as well. Exact,
  parent-scoped upgrades move the coverage config loader to js-yaml 4.3.2
  and dbinfoz to mssql 12.7.9/tedious 20, removing sprintf-js. YAML config
  loading and schema queries through the actual upgraded adapter APIs pass
  three focused compatibility/lockfile checks; Core build/typecheck and CLI
  typecheck/build/smoke also pass. The Core audit gate now rejects findings
  at every severity. No live SQL Server connection was used in these tests.
- The retained-closure run passes root clean-install/audit checks, release
  planning/audit safety tests, shared builds, Core install-script/dependency/
  audit/build/typecheck/lint checks, and CLI install-script/dependency/audit/
  typecheck/build/smoke/runtime-boundary/artifact checks. The runtime-boundary
  check uses the pinned Node version and packages both Cisco and OLMo
  templates without forbidden credential files.
- All 30 stages of the complete profile pass on Server1, including Rust
  bootstrap/preflight, format, locked check, 11 normal tests, the separately
  invoked ignored benchmark, and cargo audit. The source bundle checksum
  and checkout SHA were verified before execution. Validation used an
  isolated checkout under the Server1 user's cache because the pre-existing
  checkout had local changes; those files and its HEAD were preserved.
  This successful Linux run supersedes the earlier macOS-only Rust blocker.
  The local evidence log is
  `/tmp/opencircuit-server1-retained-7f0e8ddee.log`. These documentation-only
  follow-ups do not change the validated runtime source.
- A minimal, read-only Cisco request was attempted with existing credentials
  and returned HTTP 401. Metadata-only checks confirm that both the shell
  and application-file tokens are expired. Neither credentials nor raw API
  bodies were recorded in repository evidence; a fresh approved token is
  required before this test can pass. Credential files and user config were
  not changed.

No audit acceptance was added. Do not enable publishing automation or promote
an artifact before the required platform gates and maintainer review finish.

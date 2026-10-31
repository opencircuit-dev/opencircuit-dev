# CI and release reference audit

Canonical source repository: `opencircuit-dev/opencircuit-dev`
Public artifact repository: `opencircuit-dev/opencircuit`

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
- Binary packaging remains a separate future product surface; it is not part of
  the current CLI release contract.
- Credentialed provider workflows remain opt-in and are not part of the
  deterministic default validation path.

## Reference policy

Repository-owned source links must use
`https://github.com/opencircuit-dev/opencircuit-dev` or its `/issues`,
`/discussions`, and `/blob/main/...` descendants. Links to the separate public
artifact repository must use `https://github.com/opencircuit-dev/opencircuit`.
Historical upstream Continue links in inherited changelogs and comments are
retained as attribution/history and are not release endpoints. Third-party
links in workflow comments and dependency metadata are not project references.

Main-branch validation builds and checks the exact archive but does not publish
it. `stable-release.yml` is the only stable publisher: it validates the source
version, runs the dependency/install-script/release gates, preflights the
public-repository immutability checks, and only then creates the reviewed
source tag, publishes that exact tarball to npm with provenance, and pushes the
same tarball plus checksum, SBOM, notices, and provenance to
`opencircuit-dev/opencircuit` via `scripts/publish-release-artifacts.sh`.
Publication is protected by the `stable-release` environment and immutable
same-version checks. Checksum and metadata verification remain mandatory for
the packaged user install path.

Notices and the SBOM both come from `scripts/cli-bundle-closure.mjs`, which
reads the esbuild metafile (`extensions/cli/dist/meta.json`) and ties every
bundled third-party package to its entry in the CLI, Core, or root lockfile.
Packaging fails if a bundled package has no lockfile entry, a version mismatch,
or no declared license, or if the committed
`extensions/cli/THIRD_PARTY_NOTICES.txt` does not list exactly the bundled
closure. After a dependency change, run `npm run build` and
`npm run generate:notices` in `extensions/cli` and commit the result; main
validation fails on a stale notices file.

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

## Reviewed upstream dependency integration

This sync imports public upstream `162bbe8ce40cea4159336695b3b118849bf22892`,
including the accepted dependency
remediation PR 85 and retired-surface matcher PR 86. It preserves the internal
CLI 1.0.2, Cisco OAuth/profile packaging, trusted internal workflow caller, and
zero-finding tooling/Core audit gates.

Zod 4.6.7 and OpenAI 6.0.0 replace their vulnerable dependency chains, with
explicit schema/declaration compatibility changes and native draft-7 JSON
schema generation. Internal shared-package Vitest runners remain in place.
Lockfiles are regenerated from internal baselines, retaining the reviewed
coverage-loader js-yaml 4.3.2 override.

The deprecated generic `database` provider and `dbinfoz`/MSSQL/tedious/Azure
Identity/MSAL chain are removed. This supersedes the earlier database-adapter
upgrade and compatibility test described above: there is no remaining adapter
to validate. Existing `database` configuration produces an explicit nonfatal
warning directing users to database MCP. The compatibility check now ensures
the retired driver chain is absent while retaining the coverage YAML test.
The separate PostgreSQL provider, SQLite storage and model-provider
authentication are unchanged. No audit suppression or cross-major override
is used.

Validation of this integration must use Node 24.19.0, the exact internal
retained-closure profile, and Cisco auth/OS-token-store/policy/entitlement/
profile/packaging regressions before PR readiness. Historical Server1 evidence
above does not validate this new integration revision.

Local integration evidence (macOS, Node 24.19.0, npm 12.0.2):

- Exact internal retained-closure passed, including locked reinstalls, zero
  root/Core/CLI audit findings, build/typecheck/lint/policy, smoke, runtime
  boundary and public artifact/profile-exclusion checks.
- CLI: 1,777 passed, 6 skipped; lint has zero errors and five existing warnings.
- Core focused config/log/OpenAI: 395 passed; OpenAI converter Jest: 24 passed.
- Config YAML: 295; fetch: 105; terminal-security: 245; SDK auth/token store: 14;
  adapters: 158 passed, 5 live-provider tests skipped.
- Release/profile/packaging/CI/runtime checks: 37; retired-surface tests: 15,
  plus the repository guard; full formatting and Git whitespace checks passed.
- CLI e2e: 64 passed, one live invalid-Anthropic-key assertion blocked by local
  issuer trust (`unable to get local issuer certificate`). A targeted retry
  with Node system CAs also failed. TLS validation was not disabled and this
  is not claimed as a passing e2e run.

A shared Vitest-cache startup collision during parallel validation was
resolved by rerunning shared suites without concurrent workspace runners.
Linux validation, protected release, live Cisco SSO and maintainer approval
remain separate from these local deterministic results.

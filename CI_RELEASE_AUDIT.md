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
  Development-only release tooling is checked by a fail-closed, expiring
  exception at `scripts/dependency-audit-exceptions.json`; it accepts only the
  three exact npm-bundled findings, versions, paths, and advisory URLs recorded
  there. Any new or changed finding fails validation.

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

The retained-closure profile passes root dependency checks, shared package
builds, Core install-script/dependency/audit/build/typecheck/lint checks, CLI
install-script/dependency/audit/typecheck/build, and CLI smoke tests. The
runtime-boundary assertion is structurally valid and the loopback request
passes, but the local run reports Node `v26.7.0` instead of the repository pin
`24.19.0`; run that final assertion on the pinned Ubuntu/Node environment.

## Internal upstream sync follow-up

PR #5 imports upstream `1e9967945023cea8e2e7fc4630771b5640a9e969`
into internal baseline `50163baeeae70d9d6eff9ad57893d9c0d6fdf785`.
The following evidence supersedes the historical validation summary above
for this sync. Validation uses Node.js `24.19.0` and npm `11.17.0`.

- Core now approves only `@parcel/watcher@2.6.0` for its reviewed install
  hook. The lockfile pins its registry tarball with SHA-512 integrity. The
  hook invokes `node-gyp rebuild` only when
  `npm_config_build_from_source=true`; it does not download or execute a
  remote installer. Native prebuilds are separate version-pinned optional
  packages. A fresh install and the existing install-script and dependency
  policy checks pass. This is not a general approval for native install hooks.
- The exact Core deprecation set changes from 16 warnings to 14: `abab@2.0.6`,
  `whatwg-encoding@2.0.0`, and `domexception@4.0.0` disappear, while
  `glob@10.5.0` appears through `babel-plugin-istanbul@8.0.0` and
  `test-exclude@7.0.2`. The latest published Babel plugin still requires
  test-exclude 7. The warning baseline records this reviewed compatibility
  constraint without forcing a major transitive override; its existing
  `2026-12-31` expiry and owning-dependency upgrade exit path remain unchanged.
  The clean-install deprecation check passes. A warning entry is not a
  vulnerability exception.
- Fresh root lockfile audits against the same registry report 52 affected
  package entries on the baseline (2 critical, 43 high, 7 moderate), versus
  48 on the sync (0 critical, 41 high, 7 moderate). Every flagged package name
  on the sync is also flagged on the baseline; this does not establish that
  every dependency path or advisory is unchanged. Counts include transitive
  metavulnerabilities and are not counts of distinct advisories. Registry
  advisory metadata can change independently of the lockfile.
- The root exception check still fails. Its three npm-bundle exceptions do
  not cover the inherited Jest/release-tooling findings or additional bundled
  findings. The registry currently offers no patched version of `braces`
  (latest `3.0.3`) or `sprintf-js` (latest `1.1.3`) outside their reported
  affected ranges. Targeted compatible updates made no lockfile changes.
  Changing CLI npm alone would not repair these project dependency chains.
  No audit exception has been added or expanded. Full retained-closure
  validation and merge/release readiness remain blocked until the owning
  chains are removed or replaced with validated alternatives, patched
  packages become available, or maintainers explicitly review a scoped risk
  decision. The earlier passing functional checks do not waive this gate.

Reproduce the two repaired Core checks from `core/`:

```bash
node ../scripts/check-deprecation-policy.mjs --no-audit --no-fund
npm run check:install-scripts
npm run check:dependency-policy
```

Rerun `npm run validate:retained-closure` at the repository root after audit
remediation. Do not enable publishing automation or promote a new artifact
while required gates remain blocked.

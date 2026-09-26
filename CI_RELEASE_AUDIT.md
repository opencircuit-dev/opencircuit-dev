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

## Deferred references

- VS Code, binary, and other non-retained workflows remain in the repository
  but are explicitly separate surfaces in `README.md` and `CONTRIBUTING.md`.
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

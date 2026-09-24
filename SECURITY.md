# Security Policies and Procedures

Open Circuit takes security reports seriously. Do not disclose sensitive
vulnerabilities in a public issue.

## Reporting a vulnerability

Report security bugs privately to `opencircuit-dev@proton.me` with:

- a description of the issue;
- affected versions or commit;
- reproduction steps or a proof of concept;
- potential impact;
- suggested mitigation, if known.

Do not include real credentials, tokens, private keys, or customer data in the
report.

Do not report security vulnerabilities through public issues or discussions.

The security team will acknowledge the report and coordinate verification,
remediation, and disclosure with the reporter.

## Disclosure policy

Reports are triaged privately. Maintainers will confirm the affected scope,
prepare fixes for supported versions, and coordinate release or advisory
publication when appropriate.

## Approved npm install scripts

Core, CLI, and their retained shared packages use npm 11's version-pinned
`allowScripts` policy. Only the exact package versions listed in the respective
`package.json` files may run install or prepare hooks. A dependency upgrade
must add a new exact-version approval only after reviewing the new hook;
name-only and wildcard approvals are not permitted.

The current approvals are limited to the retained build/runtime closure:

- `@biomejs/biome`: installs the reviewed formatter binary used by Core tooling.
- `esbuild`: installs the reviewed platform bundler binaries used by Core/CLI builds.
- `onnxruntime-node`: installs the reviewed native ONNX Runtime binary required by Core.
- `protobufjs`: performs its reviewed generated-runtime setup.
- `macos-export-certificate-and-key`: builds the reviewed platform certificate helper used by `system-ca`.
- `puppeteer` and `puppeteer-chromium-resolver`: install the reviewed browser/runtime assets used by Core tooling.
- `sqlite3`: downloads a reviewed N-API binary or builds the reviewed native fallback.
- `unrs-resolver`: installs its reviewed native resolver binaries used by the shared package and ESLint toolchains.
- `win-ca`: performs its reviewed platform certificate-module setup.

The same package may appear at multiple exact versions because Core includes
local shared packages with their own lockfiles. Each listed version was
reviewed as an install hook; adding a new version still requires a separate
review.

The Core `@tootallnate/once` 2.0.1 override is a temporary upstream-chain
workaround. It is intentionally exact-version pinned and checked against the
lockfile by `npm run check:dependency-policy`. Remove it only after the
upstream dependency chain no longer resolves an affected version and the
retained-closure audit remains clean.

These approvals authorize install-time code execution; they do not suppress
`npm audit`. Reviewers must re-run the pending-script check after dependency
changes and keep any new package or version unapproved until reviewed.

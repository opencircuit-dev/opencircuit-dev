# Changelog

All notable changes to the Open Circuit CLI (`@opencircuit/cli`, command `oc`).
Newest releases first. Earlier upstream Continue CLI history is not carried forward.

## 1.0.3 (2026-10-31)

### Features

- Interactive model selection with persisted model preferences.
- Improved internal release packaging with protected-profile provenance.

### Security and Packaging

- Validate the combined bundled and install-time dependency license closure.
- Apply dependency security fixes and corrected ADF packaging.

## 1.0.2 (2026-10-23)

### Features

- Cisco Circuit zero-config sign-in: Cisco SSO (Entra ID) with a localhost callback; tokens stored in the OS credential store.
- Cisco Circuit gateway and policy integration; entitled models are discovered automatically.
- All Cisco-entitled models get the full tool set, with no capability warning.
- `oc init` installs the packaged Cisco profile (mode 0600) from the internal release package.
- Provider templates added for OLMo, Meta Muse and DevNet.
- Daily token usage tracking and management commands.
- Provider request throttling with improved exponential backoff.
- Native platform trust store support, replacing bundled CA dependencies.

### Bug Fixes

- macOS Keychain: tokens are stored in chunks, so large tokens no longer exceed the `security` 4 KB input-line limit; existing single-item tokens still load.
- Unsupported Node.js versions now report actionable recovery guidance.
- Sessions retain their revision on save.

### Security

- The Cisco profile is no longer tracked in Git. It is injected only during the internal release, validated, recorded in provenance and securely deleted afterwards.
- Public artifacts fail validation if they contain Cisco profile data.
- Release artifact checks forbid credential and environment files.
- Vulnerable dependency chains were removed from the test and release tooling.

### Packaging

- Internal packaging supports both npm 10/11 (array) and npm 12 (package-keyed) `npm pack --json` output.

## 1.0.1 (2026-09-26)

### Bug Fixes

- Reports unsupported Node.js versions and keeps the runtime version prefix in diagnostics.

### Packaging

- Internal CLI packaging and release workflows, plus post-merge artifact publication.
- Cisco BYOM support, with an `oc init` command for local template setup.

## 1.0.0 (2026-09-18)

- First Open Circuit CLI release, renamed from Continue CLI, with `oc` install scripts for macOS, Linux and Windows.

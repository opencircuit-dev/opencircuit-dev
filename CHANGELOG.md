# Changelog

All notable changes to Open Circuit are documented here.

This repository keeps a lightweight release-history file for local documentation and release traceability. For packaged CLI artifacts, use the GitHub Release entries and the corresponding release tarballs.

## Unreleased

### Internal CLI 1.0.7

- Backport public Core and YAML configuration diagnostics through upstream
  `11ba2c5e8`, including nonfatal optional MCP discovery and config-dependent
  tool loading. Keep configured chat models available when those optional
  facilities fail, and retain the internal OAuth and embedding behavior.
- These source changes do not replace the published internal 1.0.6 archive.
- Update the Core and CLI Hono closures to address newly reported audit
  findings without changing the strict release audit policy.

## 1.0.6

### Internal CLI 1.0.6

- Treat policy entries marked `available: false` as unavailable in the model
  picker and gateway adapter, and add a protected capability probe for
  non-streaming and streaming route qualification.
- Use a new protected artifact identity rather than replacing internal 1.0.5.

## 1.0.5

### Internal CLI 1.0.5

- Align the internal package version with public CLI 1.0.5. Discovery,
  bounded recovery, and file-edit safeguards already shipped internally in
  1.0.4; no public dependency or audit-policy downgrade is imported.
- Preserve Cisco SSO/profile handling, entitled-model policy, internal Core
  validation, and the existing approved license and strict audit gates.
- Protected archive generation requires canonical Server1 retained-closure
  validation; source version alone does not imply publication or a Mac upgrade.

## 1.0.4

### Internal 1.0.4 integration

- Integrate public 1.0.4 discovery while keeping Cisco's entitled-model policy
  authoritative and preserving strict internal audit and license gates.
- Merge bounded missing-argument recovery and exact Read path-alias
  normalization after validating the discovery baseline independently.
- Preserve permission checks, stop on policy denials, and constrain direct
  single-file edits to their explicit destination. See
  [file-edit safety](extensions/cli/docs/file-edit-safety.md) for scope and limits.
- These source merges did not themselves publish a protected archive or
  replace a runtime; qualification is recorded by the internal distribution.

### CLI 1.0.4 release candidate

- Discover chat models in `/model` for OpenAI, Anthropic, Gemini, and
  OpenAI-compatible providers, including BYOM, Meta, and OLMo.
- Keep configured models immediately available when catalogs are unsupported,
  unreachable, or contain no identifiable chat models. Custom IDs remain
  explicitly configurable.
- Preserve credentials, endpoint settings, chat options, and OLMo's disabled
  tools. Discovered entries remain in memory; selections persist with an opaque
  provider-profile fingerprint without storing credentials.
- Retain provider-qualified picker labels, scrolling, session-only selection
  fallback, and agent-file precedence across configuration reloads.
- Keep the 1.0.3 license-closure, provenance, SBOM, notices, install-script, and
  release-audit gates. Existing templates and credentials are not overwritten
  by installation.
- This source version is not publication: 1.0.4 becomes downloadable only after
  the separately approved stable-release workflow. Versions 1.0.0 through 1.0.2
  remain withdrawn; 1.0.3 remains the rollback release.

- Documented and clarified the packaged CLI vs. source-build onboarding path.
- Tightened root dependency ownership and repository hygiene for retained package boundaries.
- Added a repository-level CLA and release-history entry point.

## 1.0.0

- Initial Open Circuit release for the CLI and Core workflow.
- Release packaging and checksum verification workflow for the installable `oc` tarball.
- Core and CLI retained-closure validation profile for supported runtime surfaces.

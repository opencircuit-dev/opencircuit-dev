# Changelog

All notable changes to Open Circuit are documented here.

This repository keeps a lightweight release-history file for local documentation and release traceability. For packaged CLI artifacts, use the GitHub Release entries and the corresponding release tarballs.

## Unreleased

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

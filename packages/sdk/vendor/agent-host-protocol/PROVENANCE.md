# Agent Host Protocol dependency provenance

- Upstream: `https://github.com/microsoft/agent-host-protocol.git`
- Source commit: `a768e7444261f27748d29847cebefc61d2c5dcf1`
- Protocol target: AHP 1.1.0 draft
- Package name: `@microsoft/agent-host-protocol`
- Package metadata version: `1.0.0` (the upstream draft intentionally had
  unreleased protocol types with this package metadata)
- Build commands:
  - `npm ci --ignore-scripts` (upstream root)
  - `npm run generate:typescript` (upstream root)
  - `npm ci --ignore-scripts` (upstream `clients/typescript`)
  - `npm run build` (upstream `clients/typescript`)
- Vendored output: the generated `dist/` tree from that build
- SHA-256 of the sorted `dist/` file/hash manifest (source maps omitted from
  the vendored distribution): `d45e48f97a5bd5d67e5dbdba982f0f1e9eab152c7f3181ad9bb64f03fcd38301`
- License: MIT, Microsoft Corporation; authoritative text is the vendored
  `LICENSE` file.
- The private wrapper package names used by Open Circuit are workspace and
  publish-boundary names only; the generated protocol client remains the
  upstream output from the pinned source commit above.

The package is kept local until the upstream draft is released and the
generated client can be consumed by an exact published version. A future
update must regenerate from the new pinned commit and replace this record.

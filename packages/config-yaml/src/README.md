# `@opencircuit/config-yaml`

This package contains shared YAML configuration parsing and registry helpers
used by Open Circuit. The package exposes a Node entry point and a browser
entry point; keep their behavior compatible when changing shared parsing
logic.

`src/index.ts` re-exports the browser utilities, registry client, and
`parseAgentFileRules()`. The `load/` modules contain configuration unrolling,
merging, and client rendering; check their tests when changing those
semantics. Keep credential values in the consuming runtime's secret store,
not in committed YAML examples.

## Development

From the package root (`packages/config-yaml`):

```bash
npm run build
npm test
```

`npm run generate-schema` rebuilds the package and generates the JSON schema.
Before publishing a package version, follow the repository's current
release/versioning policy and verify the build and tests; this guide does not
prescribe a standalone `npm publish` command.

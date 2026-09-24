# Open Circuit agent guidance

Open Circuit is a Node.js/TypeScript repository centered on the CLI in
`extensions/cli/` and the reusable Core runtime in `core/`.

## Development environment

- Use Node.js `24.19.0` from `.nvmrc` and `.node-version`.
- Use npm and the lockfiles committed with each retained package.
- Read the root `README.md`, `CONTRIBUTING.md`, and the relevant package
  `package.json` before making changes.

## Validation

For Core changes:

```bash
cd core
npm run build
npm run tsc:check
```

For CLI changes:

```bash
cd extensions/cli
npm run typecheck
npm run build
npm run test:smoke
```

Use the fixed retained-closure validation profile for changes affecting
package boundaries, declaration output, workspace configuration, or runtime
resolution.

## Change boundaries

- Do not commit credentials, tokens, private keys, customer data, or generated
  production artifacts.
- Preserve package and environment-variable identifiers when compatibility
  requires them.
- Treat VS Code, binary, and other deferred surfaces as separate scopes.
- Keep changes atomic and document rollback and validation.
- Prefer read-only discovery before modifying files.

## Pull requests

Describe the exact scope, affected packages, validation commands, runtime
versions, and any limitations. Keep unrelated cleanup in a separate change.

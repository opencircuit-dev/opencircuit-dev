# How to Contribute

Thanks for contributing to Open Circuit. Please review the
[Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or pull request.

## Reporting issues

Search existing issues first. Include a clear title, affected commit or
version, reproduction steps, expected behavior, actual behavior, and a focused
test case when possible. Report security issues through
[SECURITY.md](SECURITY.md), not a public issue.

## Pull requests

Keep pull requests focused and include tests for affected behavior. Describe
the exact files and packages changed, validation performed, runtime versions,
and any known limitation. Do not commit credentials or generated production
artifacts.

## Review and merge requirements

Pull requests require a maintainer review, an accepted contributor license
agreement, and passing required GitHub checks before merge. Required checks
vary by the packages and runtime surfaces changed. Run the relevant validation
commands locally before requesting review, and resolve merge conflicts against
the default branch before merge.

Maintainers may require the retained-closure validation profile for changes
affecting package boundaries, declaration output, workspace configuration, or
runtime resolution.

## Development

Use Node.js `24.19.0` from `.nvmrc` and `.node-version`. The primary product
path is the CLI backed by Core:

```bash
cd core
npm install
npm run build
npm run tsc:check

cd ../extensions/cli
npm install
npm run typecheck
npm run build
npm run test:smoke
```

Changes affecting package boundaries, declaration output, workspace
configuration, or runtime resolution require the fixed retained-closure
validation profile.

## Naming and utility placement

Name files and symbols after the behavior they own. Prefer specific names such
as `loadConfig.ts`, `formatError.ts`, or `findWorkspaceRoot.ts` over new generic
`utils.ts`, `helpers.ts`, or `misc.ts` files. Existing generic utility
directories remain supported, but new code should either use an existing
domain-specific module or introduce a narrowly named module in the owning
domain.

Keep tests beside the implementation when practical. Put shared fixtures and
test-only factories in `test/` or `test-helpers/`, and do not import
production code from a test-only helper.

See [`TESTING.md`](TESTING.md) for the test architecture and
[`DOCUMENTATION.md`](DOCUMENTATION.md) for documentation placement.

## Large files and generated assets

Do not commit downloaded model weights, tokenizer caches, build output,
release artifacts, logs, or local databases. Files larger than 1 MiB and
model/tokenizer assets require an explicit ownership, licensing, provenance,
packaging, and validation explanation in the pull request. Follow
[`LARGE_FILES.md`](LARGE_FILES.md) before adding an exception.

## Scope and compatibility

The retained product is the CLI, Core, and their shared packages. The VS Code
extension and VSIX are deferred surfaces with separate validation scope.
Preserve `@opencircuit/*` package names and `OCIRCUIT_*` environment variables
when compatibility requires them.

## Contributor agreement

Contributors must accept the project's
[CLA](CLA.md) through the configured repository workflow before merge.
See the [CHANGELOG.md](CHANGELOG.md) for release history and the project docs for current versioning notes.

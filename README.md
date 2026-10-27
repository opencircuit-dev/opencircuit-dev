# Open Circuit

Open Circuit is a terminal coding agent built around the `oc` command and a
reusable Core runtime. Use it interactively or run it headlessly in scripts.

[![CLI](https://img.shields.io/badge/CLI-1.0.2-111827)](extensions/cli/README.md)
[![Node.js](https://img.shields.io/badge/Node.js-24.19.0-16a34a)](.nvmrc)
[![License](https://img.shields.io/badge/license-Apache--2.0-2563eb)](LICENSE)

## Start as a user

Read the [QUICKSTART](QUICKSTART.md) for installation, provider configuration,
and first commands. This source checkout identifies the CLI package as
**1.0.2**. A source version is not proof that its release archive is available;
check the [public distribution repository](https://github.com/open-circuit-dev/opencircuit)
for the latest published tarball and checksum before installing.

The npm package is not published. Install from a verified release tarball when
one is available; do not install an unpublished version from the registry.

## Project scope

The maintained product is the CLI and Core runtime:

| Area            | Location             | Responsibility                                        |
| --------------- | -------------------- | ----------------------------------------------------- |
| CLI             | `extensions/cli/`    | `oc` commands, sessions, terminal UI and packaging    |
| Core            | `core/`              | Providers, agent runtime, indexing, editing and tools |
| Shared packages | `packages/`          | Configuration, model metadata, fetch and security     |
| Validation      | `tests/`, `scripts/` | Build, release, runtime-boundary and test checks      |

The standalone VS Code extension and public VSIX Marketplace distribution
have been retired. Native OVSCode integration is maintained separately.

## Requirements

- Node.js `24.19.0` is the project baseline; supported range is
  `>=24.19.0 <27`.
- npm and Git.

Use the version checked into `.nvmrc` and `.node-version`:

```bash
nvm install 24.19.0
nvm use 24.19.0
node --version
npm --version
```

Global npm packages are installed per Node version. If `oc` is missing after
switching Node versions, reinstall it from the release tarball you downloaded:

```bash
npm install --global ./opencircuit-cli-X.Y.Z.tgz
command -v oc
oc --version
```

## Use a provider

For hosted Open Circuit access, put `OCIRCUIT_API_KEY` in the private
`~/.ocircuit/.env` file. The default endpoint is `https://api.ocircuit.dev/`;
set `OCIRCUIT_API_BASE` only for another compatible endpoint.

For direct providers, select one provider in `config.yaml` and place its key
in `~/.ocircuit/.env`, not in the YAML file:

```dotenv
OPENAI_API_KEY=replace-with-your-key
```

The CLI also supports Anthropic, Gemini, OpenAI-compatible endpoints and
Ollama-hosted OLMo. Provider templates are installed under
`~/.ocircuit/templates/`; existing templates are not overwritten. See
[QUICKSTART](QUICKSTART.md) for configuration examples, including BYOM and
OLMo.

Never commit API keys, `.env` files, or secret-bearing configuration.

## Build and validate from source

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making a change. The standard
local CLI checks use Node.js `24.19.0`:

```bash
cd extensions/cli
npm ci
npm run typecheck
npm run build
npm run test:smoke
```

Core changes should also be built and typechecked:

```bash
cd core
npm ci
npm run build
npm run tsc:check
```

For package-boundary, declaration, workspace, or runtime-resolution changes,
run the fixed retained-closure profile from the repository root:

```bash
npm run validate:retained-closure
```

## Security boundaries

Local command execution uses a fixed non-login shell and a minimal environment;
shell profiles and the parent `PATH` are not inherited. Public URL tools accept
only public HTTPS destinations on port 443. These restrictions can affect
existing workflows and do not provide an operating-system sandbox. Review
[SECURITY.md](SECURITY.md) for details.

## Release preparation

Maintainers build and validate release artifacts through the registered
orchestration workflow. The local packaging command is:

```bash
npm --prefix extensions/cli run release:artifact
```

It stages a versioned tarball and SHA-256 checksum under
`release-artifacts/vX.Y.Z/`. Staging files are ignored and are not source
changes. A staged archive is not a published GitHub Release or npm package.

## Documentation and contribution

- [Beginner QUICKSTART](QUICKSTART.md)
- [CLI guide](extensions/cli/README.md)
- [Contribution guide](CONTRIBUTING.md)
- [Test architecture](TESTING.md)
- [Documentation map](DOCUMENTATION.md)
- [Security policy](SECURITY.md)
- [Release changelog](CHANGELOG.md)

Open Circuit is released under the [Apache License 2.0](LICENSE).

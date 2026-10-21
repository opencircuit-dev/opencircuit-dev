# Open Circuit

> A terminal-native coding agent for working through real software tasks.

[![CLI](https://img.shields.io/badge/CLI-1.0.0-111827)](extensions/cli/README.md)
[![Node.js](https://img.shields.io/badge/Node.js-24.19.0-16a34a)](.nvmrc)
[![License](https://img.shields.io/badge/license-Apache--2.0-2563eb)](LICENSE)

Open Circuit is a focused coding-agent project built around the `oc` command
and a reusable Core runtime. It can work interactively in a terminal or run
headlessly in scripts and CI.

## Start here

Choose the path that matches your goal before you install anything:

- Use Open Circuit as a user: follow the packaged CLI install path below.
- Contribute to Open Circuit itself: follow the source-build path later in this file.
- **Updating**: To update your CLI, download the latest release tarball and run the install command again.

New to Open Circuit? Follow the beginner guide:

**[Read QUICKSTART.md](QUICKSTART.md)**

> Open Circuit CLI 1.0.0 is currently distributed as a
> [GitHub Release asset](https://github.com/open-circuit-dev/open-circuit/releases/tag/v1.0.0).
> npm publication is planned but not yet available.
>
> The release tarball is the default install path for end users. The source-build
> flow is intended for local development and contributor workflows.

## What is included

| Area       | Location                | Purpose                                                     |
| ---------- | ----------------------- | ----------------------------------------------------------- |
| CLI        | `extensions/cli/`       | The installable `oc` command                                |
| Core       | `core/`                 | Shared agent, configuration, and provider runtime           |
| Packages   | `packages/`             | Fetching, model information, adapters, and security         |
| Validation | `tests/` and `scripts/` | Builds, smoke tests, release checks, and runtime boundaries |

The retained product path is the CLI and Core runtime. Standalone VS Code
extension and public VSIX Marketplace distribution have been retired. Native
OVSCode integration is maintained separately.

## Architecture

Open Circuit follows this runtime path:

`oc` CLI -> CLI services and streaming -> Core runtime -> model providers and tools

The CLI owns command-line behavior, interactive and headless execution, session
management, and terminal presentation. Core provides reusable agent capabilities
for the CLI and retained host integrations, including model providers, configuration,
codebase indexing, editing, autocomplete, MCP tools, and protocol communication.

A typical CLI request works as follows:

1. `extensions/cli/src/index.ts` parses commands and options.
2. `extensions/cli/src/commands/chat.ts` selects interactive or headless execution.
3. CLI services load configuration, the selected model, permissions, and agent files.
4. `extensions/cli/src/session.ts` creates, resumes, or persists the conversation.
5. `extensions/cli/src/stream/` streams the model response and handles tool calls, retries, compaction, and continuation.
6. Core and CLI tools read files, edit code, search the repository, run commands, and connect to MCP servers.

## Requirements

- Node.js `24.19.0` from [`.nvmrc`](.nvmrc) or [`.node-version`](.node-version)
- npm
- Git

If you use `nvm`, set the Node version as your default so a fresh shell still resolves the correct global binaries:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 24.19.0
nvm alias default 24.19.0
nvm use 24.19.0

node --version
npm --version
```

If `oc` is not found in a new shell, reload NVM and select the same version again:

```bash
source "$NVM_DIR/nvm.sh"
nvm use 24.19.0
command -v oc
```

## Install the CLI (default for end users)

This is the default path for trying Open Circuit or using it as a CLI user.
If you are contributing to the project itself, skip to the source-build section
below.

Download these files from the GitHub `v1.0.0` release:

- `opencircuit-cli-1.0.0.tgz`
- `opencircuit-cli-1.0.0.tgz.sha256`

Verify the download from the directory containing both files:

```bash
shasum -a 256 -c opencircuit-cli-1.0.0.tgz.sha256
```

Install the CLI:

```bash
npm install --global ./opencircuit-cli-1.0.0.tgz
oc --version
```

Expected output:

```text
1.0.0
```

The npm registry package is not available yet. After publication, the install
command will be:

```bash
npm install --global @opencircuit/cli@1.0.0
```

## Updating the CLI

When a new version is released:

1. Download the new release tarball (`opencircuit-cli-X.Y.Z.tgz`) from the [GitHub Releases page](https://github.com/open-circuit-dev/open-circuit/releases).
2. Install the new version over the old one:
   ```bash
   npm install --global ./opencircuit-cli-X.Y.Z.tgz
   ```
3. Verify the upgrade:
   ```bash
   oc --version
   ```

## Build from source (contributor workflow)

Use this path only when developing Open Circuit itself:

Review the [contributor workflow](CONTRIBUTING.md) and
[Contributor License Agreement](CLA.md) before opening a pull request. The
agreement remains project policy, but GitHub Actions does not currently enforce
CLA acceptance.

```bash
cd core
npm install
npm run build
npm run tsc:check

cd ../extensions/cli
npm install
npm run build
npm run typecheck
npm run test:smoke
```

Run the locally built command:

```bash
./dist/oc.js --version
./dist/oc.js --help
```

## Validation

The complete retained-closure profile runs on Linux with Node.js `24.19.0`:

```bash
npm run validate:retained-closure
```

Use `--skip-install` only after the committed lockfiles have been installed.
The profile covers dependency policy, Core and CLI builds, the CLI-to-Core
runtime boundary, and release-artifact shape.

## Provider keys

When using the hosted Open Circuit API, set `OCIRCUIT_API_KEY`. The default
endpoint is `https://api.ocircuit.dev/`; set `OCIRCUIT_API_BASE` only for a
different compatible endpoint. The CLI loads these values from
`~/.ocircuit/.env` or the process environment:

```bash
mkdir -p ~/.ocircuit
chmod 700 ~/.ocircuit
printf '%s\n' 'OCIRCUIT_API_KEY=your-hosted-api-key' > ~/.ocircuit/.env
chmod 600 ~/.ocircuit/.env
```

For direct providers, use a local `config.yaml` with
`apiKey: ${{ secrets.PROVIDER_API_KEY }}` and the matching provider
environment variable in `~/.ocircuit/.env`. See the
[beginner quickstart](QUICKSTART.md) for provider-specific examples. Never
commit API keys.

## Daily token allowance

The CLI records aggregate input and output token usage locally without storing prompts, credentials, or session IDs. Inspect today and recent days with:

    oc usage

Set or clear an opt-in local daily token allowance with:

    oc usage --set-daily-limit 100000
    oc usage --clear-daily-limit

Usage state is stored in ~/.ocircuit/usage.json with restrictive permissions. The
CLI warns at 80% by default and blocks the next request after the allowance is
reached. Set OCIRCUIT_DAILY_TOKEN_WARNING_PERCENT to change the warning threshold.

## Stage CLI release assets

This section is for maintainers preparing a GitHub Release asset.

From the repository root:

```bash
npm --prefix extensions/cli run release:artifact
shasum -a 256 -c release-artifacts/v1.0.0/opencircuit-cli-1.0.0.tgz.sha256
```

The command creates:

- `release-artifacts/v1.0.0/opencircuit-cli-1.0.0.tgz`
- `release-artifacts/v1.0.0/opencircuit-cli-1.0.0.tgz.sha256`

Upload both files manually to the GitHub `v1.0.0` release. The staging
directory is ignored by Git and is not an installation path for end users.

### Build the internal CLI archive

From the repository root, run:

```bash
npm --prefix extensions/cli run check:release-artifact
npm --prefix extensions/cli run release:internal-artifact
```

The internal packaging command creates the versioned tarball and SHA-256
sidecar in the sibling `opencircuit-internal/` directory by default. Pass
`--output-dir <path>` to write them elsewhere. The `Package Internal CLI`
workflow builds the CLI for relevant pull requests to `main`, after those
changes merge to `main`, or when manually dispatched. Each run creates the
archive in the sibling directory on its runner and uploads both files as a
downloadable Actions artifact for 14 days.

To publish a version into the `opencircuit-internal` repository, run the
`Release Internal CLI` workflow manually and enter the version. Configure the
source repository secret `INTERNAL_RELEASE_REPO_TOKEN` with contents-write
access to `opencircuit-dev/opencircuit-internal`. The workflow builds and tests
the requested version, then commits and pushes the tarball and checksum to the
internal artifact repository root, replacing its previous root-level version.
Earlier releases remain available in the repository's commit history.

## Development map

Start changes in the layer that owns the behavior:

| Change                                | Location                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| CLI commands and flags                | `extensions/cli/src/index.ts` and `extensions/cli/src/commands/` |
| Chat streaming and tool calls         | `extensions/cli/src/stream/`                                     |
| Session creation, resume, and forking | `extensions/cli/src/session.ts`                                  |
| Shared agent runtime                  | `core/`                                                          |
| Model providers and LLM behavior      | `core/llm/`                                                      |
| Codebase indexing and search          | `core/indexing/`                                                 |
| File editing and diffs                | `core/edit/` and `core/diff/`                                    |
| Tools and permissions                 | `core/tools/` and `packages/terminal-security/`                  |
| Configuration                         | `core/config/` and `packages/config-yaml/`                       |
| Binary packaging                      | `binary/`                                                        |

Read the neighboring tests before changing behavior. Run Core validation for
Core changes and CLI validation for CLI changes. Use the retained-closure
profile when changing package boundaries, generated declarations, workspace
configuration, or runtime resolution.

## Project guides

- [Beginner quickstart](QUICKSTART.md)
- [Frequently asked questions](FAQ.md)
- [Test architecture](TESTING.md)
- [Documentation map](DOCUMENTATION.md)
- [CI and release audit](CI_RELEASE_AUDIT.md)
- [Runtime asset ownership](ASSET_OWNERSHIP.md)
- [Skipped-test decisions](TEST_SKIP_DECISIONS.md)
- [Documentation and utility inventory](DOCUMENTATION_INVENTORY.md)
- [Large-file contribution policy](LARGE_FILES.md)
- [CLI reference](extensions/cli/README.md)
- [Contributor workflow](CONTRIBUTING.md)
- [Contributor License Agreement](CLA.md)
- [Release changelog](CHANGELOG.md)
- [Build dependencies](BUILD_DEPENDENCIES.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License

Open Circuit is released under the [Apache License 2.0](LICENSE).

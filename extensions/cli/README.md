# Open Circuit CLI

The Open Circuit CLI provides the `oc` command for interactive and headless
coding-agent sessions. This package source is version **1.0.3**. Release
archives are published separately; check the
[public distribution checkout](https://github.com/open-circuit-dev/opencircuit)
for the latest available tarball. See the [QUICKSTART](../../QUICKSTART.md)
for installation guidance.

## Requirements and installation

Use Node.js `>=24.19.0 <27` (`24.19.0` is the project baseline). Once the
versioned tarball and checksum are published, verify the checksum and install
the tarball:

```bash
shasum -a 256 -c opencircuit-cli-X.Y.Z.tgz.sha256
npm install --global ./opencircuit-cli-X.Y.Z.tgz
oc --version
```

Stable releases publish the exact verified archive to npm and the public
distribution repository. Do not install an unpublished version from the npm
registry.

Installation places starter provider templates in `~/.ocircuit/templates/`
without overwriting existing files. Copy one to `~/.ocircuit/config.yaml` or
pass a configuration directly with `--config`.

## Usage

```bash
oc
oc --help
oc --config ./config.yaml
oc -p "Summarize the current git diff" --format json
```

Use `oc ls` to list sessions and `oc --resume` to resume the previous session.
In an interactive session, `/init` can generate repository guidance.

Use `/model` to open the terminal model picker. Choices show the configured
name and provider; use the arrow keys and Enter to select, or Esc to cancel.
Selection uses the chat-model index, so identical display names from different
providers remain distinct in the picker. A selected model is saved for the next
session when possible. If saving fails, the CLI reports a session-only selection
and keeps it active across service reloads. An agent-file model still takes
precedence when the model service is initialized.
Saved preferences still use configured names; use unique names for
unambiguous restoration across providers after restarting the CLI.

## Configuration and credentials

The CLI reads user configuration from `~/.ocircuit/` by default. Hosted API
credentials and provider keys belong in the private `~/.ocircuit/.env` file
or an appropriately scoped process environment variable. Never commit keys,
`.env` files, or secrets in YAML.

For provider setup, OpenAI-compatible BYOM endpoints, and OLMo through Ollama,
follow the [beginner QUICKSTART](../../QUICKSTART.md). Choose one provider for
the active config. Existing templates and active configs are not overwritten
by upgrades.

## Modes and common commands

- `oc`: start an interactive session.
- `oc -p "prompt"`: run a headless request.
- `oc ls`: list saved sessions.
- `oc --resume`: resume the previous session.
- `/init`: create repository guidance from an interactive session.

Headless mode is suitable for scripts and CI. Provide a prompt to avoid
interactive input:

```bash
oc -p "Review the current changes" --format json
```

## Compatibility and security

Local command execution uses a fixed non-login shell and a minimal
environment; shell profiles and the parent `PATH` are not inherited. Public
URL retrieval tools accept only public HTTPS destinations on port 443. These
controls can affect existing workflows and are not an operating-system
sandbox. Review the [security policy](../../SECURITY.md).

## Development

From this directory, the standard CLI checks are:

```bash
npm ci
npm run typecheck
npm run build
npm run test:smoke
```

Use `npm test -- path/to/test` for focused Vitest tests. Changes to package
boundaries, declarations, workspace configuration, or runtime resolution also
require the repository's retained-closure validation profile.

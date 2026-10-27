# Open Circuit CLI

The Open Circuit CLI provides the `oc` command for interactive and headless
coding-agent sessions. This package source is version **1.0.2**. Its release
archive is being prepared; it is not yet available from npm or the public
distribution checkout. See the [QUICKSTART](../../QUICKSTART.md) for the
currently available install path.

## Requirements and installation

Use Node.js `>=24.19.0 <27` (`24.19.0` is the project baseline). Once the
versioned tarball and checksum are published, verify the checksum and install
the tarball:

```bash
shasum -a 256 -c opencircuit-cli-X.Y.Z.tgz.sha256
npm install --global ./opencircuit-cli-X.Y.Z.tgz
oc --version
```

The npm package has not been published. Do not install an unpublished version
from the npm registry.

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

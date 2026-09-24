# Open Circuit Quickstart

This guide gets a beginner from zero to a working `oc` command.

## 0. Choose the right install path

Pick the path that matches your goal:

- Use Open Circuit as a user: follow the packaged CLI install flow in this guide.
- Contribute to Open Circuit itself: use the source-build workflow in the repository README and contributor docs instead of the packaged CLI path.

Do not start with the source-build path unless you intend to work on the project itself. The packaged release tarball is the default and simplest first-run experience for most users.

## Contributor pre-push validation

Maintainers with Ubuntu1 access can opt in to validating each new branch commit
before a GitHub push. From the repository root, configure the gate once:

```bash
git config --local ocircuit.ubuntu-gate true
git config --local ocircuit.orchestration-root /Users/brettcon/git/opencircuit/opencircuit-orchestration
```

The pre-push hook synchronizes the exact clean commit to Ubuntu1 and runs the
registered install, build, typecheck, and smoke-test workload. Successful
commit and orchestration revision pairs are cached under `.git/`, so another
push of the same commit does not rerun the workload. The first validation can
take several minutes; progress heartbeats remain visible in the terminal.

Use an explicit emergency bypass only when necessary:

```bash
OC_SKIP_UBUNTU_GATE=1 git push
```

The gate is opt-in per clone. It does not replace required GitHub checks.

## 1. Check Node.js

Open Circuit 1.0.0 expects Node.js `24.19.0`.

```bash
node --version
```

You should see `v24.19.0`. If you use `nvm`, set the version persistently and make it your default:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 24.19.0
nvm alias default 24.19.0
nvm use 24.19.0

node --version
npm --version
```

If you open a new shell and `oc` is still not found, reload NVM and select the same version again:

```bash
source "$NVM_DIR/nvm.sh"
nvm use 24.19.0
command -v node
command -v npm
command -v oc
```

This matters because global npm binaries are tied to the active Node version. A binary installed under one version can disappear from `PATH` when a new shell is opened under another version.

## 2. Install the CLI (default user path)

Open Circuit CLI 1.0.0 is currently distributed as a GitHub Release asset. It
has not been published to npm yet. This is the recommended path for most users.

If you are contributing to the project itself, skip this section and use the
source-build workflow instead.

Download both assets from the
[Open Circuit v1.0.0 release](https://github.com/open-circuit-dev/open-circuit/releases/tag/v1.0.0):

- `opencircuit-cli-1.0.0.tgz`
- `opencircuit-cli-1.0.0.tgz.sha256`

Verify the checksum from the directory containing both files:

```bash
shasum -a 256 -c opencircuit-cli-1.0.0.tgz.sha256
```

Expected output:

```text
opencircuit-cli-1.0.0.tgz: OK
```

Install the CLI:

```bash
npm install --global ./opencircuit-cli-1.0.0.tgz
```

Check the installation and confirm the binary is visible on your current shell:

```bash
command -v oc
oc --version
```

Expected output:

```text
1.0.0
```

When the package is published, the equivalent registry install will be:

```bash
npm install --global @opencircuit/cli@1.0.0
```

## 3. See the available commands

```bash
oc --help
```

The most useful first commands are:

```bash
oc                       # Start an interactive session
oc -p "Review this code" # Run one prompt and exit
oc ls                    # List saved sessions
oc --resume              # Resume the previous session
```

To bootstrap repository-specific guidance, start `oc` in the repository and
run `/init`. This interactive command asks the assistant to inspect the project
and create `AGENTS.md` plus a review rule. A standalone `oc init` command is
not provided because the existing flow needs the active session, repository
context, and write tools.

## 4. Try a first task

Open a terminal in a project directory and run:

```bash
oc
```

Then ask for a concrete task, such as:

```text
Review the current git changes and summarize the three most important risks.
Do not edit files.
```

For a one-shot command:

```bash
oc -p "Explain the structure of this project and suggest where tests live."
```

## 5. Use a configuration file

You can point Open Circuit at a specific configuration:

```bash
oc --config ./config.yaml
```

Open Circuit stores user-owned configuration and session data under the
`.ocircuit` convention. Keep API keys and other secrets in environment
variables or approved secret storage; do not commit them to a repository.

The default global configuration path is:

```text
~/.ocircuit/config.yaml
```

On Ubuntu1 for the `sysadmin` user, that expands to:

```text
/home/sysadmin/.ocircuit/config.yaml
```

The CLI also looks for its local environment file at:

```text
~/.ocircuit/.env
```

Override the global directory when you need an isolated configuration:

```bash
export OCIRCUIT_GLOBAL_DIR="$HOME/.ocircuit-test"
oc --config "$OCIRCUIT_GLOBAL_DIR/config.yaml"
```

## 6. Run without an interactive terminal

This is useful for scripts and CI:

```bash
oc -p "Summarize the current git diff" --format json
```

You can also pipe input:

```bash
echo "Review the current working tree" | oc -p
```

## 7. Use your own model provider

The hosted Open Circuit API is currently disabled by default. For local or
direct provider use, choose exactly one provider for the active configuration and
use only the matching environment variable.

Use a persistent secret file in `~/.ocircuit/.env` instead of copying keys into
multiple files or into YAML. A single-provider setup looks like this:

```bash
mkdir -p ~/.ocircuit
chmod 700 ~/.ocircuit

printf '%s\n' 'OPENAI_API_KEY=replace-with-your-key' > ~/.ocircuit/.env
chmod 600 ~/.ocircuit/.env
```

The supported provider mappings are:

- OpenAI uses `OPENAI_API_KEY`
- Anthropic uses `ANTHROPIC_API_KEY`
- Gemini uses `GEMINI_API_KEY`

Do not use `GOOGLE_API_KEY` for the documented Gemini flow unless the specific
implementation explicitly documents it. Do not create multiple provider key
files and then copy one over `.env` as a fallback; that leads to stale secrets
and wrong-provider confusion.

For a single terminal session, a runtime export is also valid:

```bash
export OPENAI_API_KEY="replace-with-your-key"
```

That is useful for quick testing, but the persistent `~/.ocircuit/.env` file is
preferred for normal usage. Avoid editing `~/.bashrc` with long-lived provider
keys because they are harder to audit and easier to leak across shells.

Never commit:

- `.env`
- provider key files
- or secrets embedded in `config.yaml`

Create a local `config.yaml` that selects one provider and references its
environment variable. For OpenAI:

```yaml
name: Local OpenAI
version: 1.0.0
schema: v1
models:
  - name: OpenAI model
    provider: openai
    model: gpt-4o-mini
    apiKey: ${{ secrets.OPENAI_API_KEY }}
    roles:
      - chat
```

The CLI package installs these four starter templates automatically in
`~/.ocircuit/templates/` without overwriting existing files:
`config-openai.yaml`, `config-anthropic.yaml`, `config-gemini.yaml`, and
`config-byom.yaml`. Select exactly one template for the active configuration,
copy it once to `~/.ocircuit/config.yaml`, and do not keep multiple provider
configs active at the same time.

Example single-provider bootstrap flow for OpenAI:

```bash
cp ~/.ocircuit/templates/config-openai.yaml ~/.ocircuit/config.yaml
chmod 600 ~/.ocircuit/config.yaml
```

The template reads the key from the environment-backed secret named
`OPENAI_API_KEY`; it does not require the key to be pasted into YAML. The
corresponding OpenAI config entry is:

```yaml
apiKey: ${{ secrets.OPENAI_API_KEY }}
```

For Anthropic, use:

```yaml
name: Local Anthropic
version: 1.0.0
schema: v1
models:
  - name: Anthropic model
    provider: anthropic
    model: claude-sonnet-4-6
    apiKey: ${{ secrets.ANTHROPIC_API_KEY }}
    roles:
      - chat
```

For Gemini, use:

```yaml
name: Local Gemini
version: 1.0.0
schema: v1
models:
  - name: Gemini model
    provider: gemini
    model: gemini-2.0-flash
    apiKey: ${{ secrets.GEMINI_API_KEY }}
    roles:
      - chat
```

After the config is in place, run a harmless validation request without exposing
credentials:

```bash
oc --config ~/.ocircuit/config.yaml \
  -p "Reply with exactly OK." \
  --silent
```

Expected result:

```text
OK
```

### Bring your own model (BYOM)

Use BYOM when you run a local or remote model server that exposes the OpenAI
Chat Completions API. The server must provide:

```text
POST /v1/chat/completions
```

If the server requires authentication, export its key before launching `oc`:

```bash
export BYOM_API_KEY="your-byom-key"
```

For an unauthenticated local server, use an empty value instead:

```bash
export BYOM_API_KEY=""
```

Create `config.yaml` with the `openai-compatible` provider:

```yaml
name: Local BYOM
version: 1.0.0
schema: v1
models:
  - name: Local model
    provider: openai-compatible
    model: my-model
    apiBase: http://127.0.0.1:8000/v1/
    apiKey: ${{ secrets.BYOM_API_KEY }}
    roles:
      - chat
```

For a remote server, replace `apiBase` with its HTTPS endpoint:

```yaml
apiBase: https://your-model-host.example/v1/
```

Keep API keys in environment-backed secrets. Custom request headers, timeouts,
and proxy settings can be supplied through `requestOptions` when the endpoint
requires them.

Test the BYOM connection with a one-shot request:

```bash
oc --config ./config.yaml -p "Reply with exactly OK." --silent
```

Run with the selected configuration:

```bash
oc --config ./config.yaml
```

For a one-shot request:

```bash
oc --config ./config.yaml -p "Summarize the current directory."
```

The CLI currently auto-detects `ANTHROPIC_API_KEY` during headless onboarding,
but explicit `--config` files are the reliable path for OpenAI, Anthropic,
Gemini, and OpenAI-compatible provider selection.

## 8. Maintainer: Stage a Local Release Asset

From an Open Circuit source checkout:

```bash
npm --prefix extensions/cli run release:artifact
```

This creates:

```text
release-artifacts/v1.0.0/opencircuit-cli-1.0.0.tgz
release-artifacts/v1.0.0/opencircuit-cli-1.0.0.tgz.sha256
```

The staging directory is ignored by Git and is not required for normal users.

## 9. Troubleshooting

### `oc: command not found`

The global npm binary directory may not be on your `PATH`. Find it with:

```bash
npm prefix --global
```

Add the reported directory to your shell `PATH`, then open a new terminal.

### The version is wrong

Check which executable is being used:

```bash
command -v oc
oc --version
```

Reinstall the package if it points to an older installation:

```bash
npm install --global release-artifacts/v1.0.0/opencircuit-cli-1.0.0.tgz
```

### You need to develop Open Circuit

Return to the repository [README](README.md) and use its **Build from source**
section. The source-development path builds Core and the CLI in dependency
order before running the CLI smoke tests.

Review the [contributor workflow](CONTRIBUTING.md) and
[Contributor License Agreement](CLA.md) before opening a pull request. The
agreement remains project policy, but GitHub Actions does not currently enforce
CLA acceptance.

## 10. More answers and examples

See [`FAQ.md`](FAQ.md) for common installation, provider, bootstrap, testing,
and documentation questions. For repository-wide contributor guidance, see
[`CONTRIBUTING.md`](CONTRIBUTING.md), [`TESTING.md`](TESTING.md), and
[`DOCUMENTATION.md`](DOCUMENTATION.md).

# Open Circuit Quickstart

This guide covers installing `oc`, choosing a model provider, and sending a
first request. To contribute to Open Circuit, use the source-build instructions
in [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## 1. Check Node.js

Open Circuit supports Node.js `>=24.19.0 <27`. Use `24.19.0` for the project
baseline:

```bash
node --version
nvm install 24.19.0
nvm use 24.19.0
```

## 2. Install a release

This source checkout identifies the CLI package as **1.0.3**. Release archives
are published separately; use only a version whose tarball and checksum are
available in the [distribution repository](https://github.com/open-circuit-dev/opencircuit).

After downloading a matching tarball and `.sha256` file, verify and install
them from the same directory:

```bash
shasum -a 256 -c opencircuit-cli-1.0.3.tgz.sha256
npm install --global ./opencircuit-cli-1.0.3.tgz
oc --version
```

The checksum command must report `OK`. Do not mix files from different
versions. Stable releases are also published to npm; install from npm only
when the exact version is available in the registry. The public distribution
repository remains the source for matching release archives and checksums.

The existing 1.0.3 archive predates the latest model-picker updates on `main`.
Regeneration is currently blocked by the release dependency audit; the source
version alone does not mean those updates are in the downloadable package.

## 3. Start the CLI

From a project directory:

```bash
oc
```

Useful first commands:

```bash
oc --help
oc ls
oc --resume
oc -p "Summarize this project" --format json
```

In an interactive session, `/init` can inspect the repository and generate
project guidance. There is no standalone `oc init` command.

Use `/model` in an interactive session to choose a configured chat model with
the arrow keys and Enter; Esc cancels. Current source shows each model's
provider and retains session-only selections across reloads when saving fails.
Give models unique configured names for reliable restoration after restarting.
See the [CLI guide](extensions/cli/README.md) for selection precedence.

## 4. Configure provider credentials

Keep provider keys in `~/.ocircuit/.env`, not in `config.yaml` or a repository.
Restrict the file permissions:

```bash
mkdir -p ~/.ocircuit
chmod 700 ~/.ocircuit
printf '%s\n' 'OPENAI_API_KEY=replace-with-your-key' > ~/.ocircuit/.env
chmod 600 ~/.ocircuit/.env
```

For Anthropic or Gemini, use `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`
respectively. For hosted Open Circuit, use `OCIRCUIT_API_KEY`; its default
service endpoint is `https://api.ocircuit.dev/`.

Select one provider in the active configuration. The CLI installs starter
templates under `~/.ocircuit/templates/` without overwriting existing files.
For example:

```bash
cp ~/.ocircuit/templates/config-openai.yaml ~/.ocircuit/config.yaml
chmod 600 ~/.ocircuit/config.yaml
```

The template refers to the environment-backed secret:

```yaml
apiKey: ${{ secrets.OPENAI_API_KEY }}
```

Run a harmless request to test the configuration:

```bash
oc --config ~/.ocircuit/config.yaml \
  -p "Reply with exactly OK." \
  --silent
```

## 5. Use a BYOM endpoint

BYOM supports servers exposing the OpenAI Chat Completions API at
`/v1/chat/completions`. Configure the endpoint and reference the key by its
environment-backed secret:

```yaml
name: Local BYOM
version: 1.0.0
schema: v1
models:
  - name: Local model
    provider: openai-compatible
    model: your-model-name
    apiBase: http://127.0.0.1:11434/v1/
    apiKey: ${{ secrets.BYOM_API_KEY }}
    roles:
      - chat
```

For an unauthenticated local server, set `BYOM_API_KEY=` in
`~/.ocircuit/.env`. For a remote server, use its HTTPS URL instead of the local
HTTP example. Plain HTTP is appropriate only on a trusted network. Custom
request headers and timeouts can be configured through `requestOptions`.

## 6. Run OLMo through Ollama

The packaged OLMo template is installed at
`~/.ocircuit/templates/config-olmo.yaml`. Copy it and set the Ollama server
address and model name to match your installation:

```bash
cp ~/.ocircuit/templates/config-olmo.yaml ~/.ocircuit/config.yaml
```

The template endpoint uses a hostname placeholder on port `11434`; replace it
with the address reachable from the machine running `oc`. Set `BYOM_API_KEY=`
in `~/.ocircuit/.env` if the server does not require authentication.

The OLMo template disables tools because the configured OLMo model does not
support native tool calling. OLMo sessions are chat-only and cannot read,
write, or edit files through tools. Other model configurations retain their
normal tool settings.

## 7. Security and troubleshooting

Local terminal execution uses a fixed non-login shell and a minimal
environment. Shell profiles and the parent `PATH` are not inherited. Public
URL retrieval accepts only public HTTPS destinations on port 443. These
restrictions may affect workflows and are not an operating-system sandbox;
see [SECURITY.md](SECURITY.md).

If `oc` is missing, check the selected Node version and executable path:

```bash
node --version
command -v node
command -v npm
command -v oc
npm prefix --global
```

Global npm packages are separate for each Node version. Reinstall the
downloaded tarball with the active Node runtime if needed. If checksum
verification fails, download the matching tarball and checksum again.

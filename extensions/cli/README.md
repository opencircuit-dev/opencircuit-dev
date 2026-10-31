# Open Circuit CLI

The Open Circuit CLI provides the `oc` command for interactive and headless
coding-agent sessions. This package source is version **1.0.3**. Release
archives are published separately; check the
[public distribution checkout](https://github.com/open-circuit-dev/opencircuit)
for the latest available tarball. See the [QUICKSTART](../../QUICKSTART.md)
for installation guidance.

This internal source package is version **1.0.3**. Source version and published
archive availability are separate. Cisco users should install the approved
internal artifact and run `oc init` to install its protected profile; public
package examples below do not include that profile.

## Internal 1.0.2 release

The current internal tarball was regenerated from merged main `79e42d9ef`.
Use `opencircuit-cli-internal-1.0.2.tgz` with its checksum and provenance from
the approved internal distribution. Local generation is not remote publication.
The source staging path is `../../release-artifacts/v1.0.2/`.

The latest validation-only source build is commit
`99678dabebc3c62bfc3990ce9be4338e4d357c1a`. It passed Server1 Core and CLI
typechecks, CLI build and smoke tests, all 941 Core tests that ran (68 skipped),
and validation-artifact generation. Its profileless CLI 1.0.3 archive SHA-256 is
`da6b52c7da439eb21824add2a0269c78341b153f0f22334e25db2f622d641df0`; this
candidate has not been published and is not the approved internal tarball
described above. Do not substitute it until the internal release-publish action
has regenerated and staged the release.

Ubuntu1 also verified and installed that exact validation artifact and passed
version/help/isolated-init checks. Protected 1.0.3 regeneration from internal
main `ec56b433b` failed on October 31 at Server1's mandatory root tooling
audit (ESLint/TypeScript-ESLint/minimatch). No new protected internal archive
was staged. The local source `release-artifacts/v1.0.3/` is a public test
package only. The approved internal 1.0.2 archive remains the installation
target; resolve the audit findings before canonical regeneration.
Compatible Hono 2.1.5 and qs 6.17.1 fixes are included in `99678dabe`, but
protected regeneration still fails the root audit. The incompatible
minimatch 11 override was removed rather than bypassing validation.

```bash
shasum -a 256 -c opencircuit-cli-internal-1.0.2.tgz.sha256 &&
  npm install --global ./opencircuit-cli-internal-1.0.2.tgz &&
  oc --version
oc init
```

Back up any existing active configuration, then copy
`~/.ocircuit/templates/config-cisco-circuit.yaml` to `~/.ocircuit/config.yaml`
and set mode `0600`. Run `oc --config ~/.ocircuit/config.yaml`, complete
browser SSO and choose an entitled model. Replace the template model placeholder
with an approved policy model if needed. `oc init` installs the protected
owner-only profile; do not substitute the generic OAuth template or manual
token/appkey configuration for Circuit onboarding.

Stable releases publish the exact verified archive to npm and the public
distribution repository. Do not install an unpublished version from the npm
registry.

Circuit uses PKCE/state/OIDC checks, refresh and OS credential storage,
coalesced model-policy loading, entitlement rejection and approved bearer routes.
The latest Server1 validation did not run retained-closure audits or e2e tests
and does not qualify live SSO or model access.
The retired generic `database` context provider warns and skips existing entries;
use database MCP instead.

## Security boundaries

Local commands use a fixed non-login shell and minimal environment, without
inheriting shell profiles or the parent `PATH`. Public URL tools accept only
public HTTPS destinations on port 443. These controls are not an operating-system
sandbox; see [the security policy](../../SECURITY.md).

## Installation

### macOS and Linux

After the package is published:

```bash
npm install --global @opencircuit/cli@1.0.0
```

Before npm publication, install the locally validated package artifact:

```bash
npm install --global ./opencircuit-cli-1.0.0.tgz
```

The Unix installer script is available from the release repository once its canonical public URL is confirmed.

### Windows PowerShell

After the package is published:

```powershell
npm install --global @opencircuit/cli@1.0.0
```

For local validation, copy `opencircuit-cli-1.0.0.tgz` to the Windows machine and run:

```powershell
npm install --global .\opencircuit-cli-1.0.0.tgz
```

After installation, initialize the packaged templates locally:

```bash
oc init
```

For hosted Open Circuit access, put the key in the application-scoped file
`~/.ocircuit/.env`:

```bash
mkdir -p ~/.ocircuit
chmod 700 ~/.ocircuit
printf '%s\n' 'OCIRCUIT_API_KEY=replace-with-your-hosted-api-key' > ~/.ocircuit/.env
chmod 600 ~/.ocircuit/.env
```

The CLI also accepts `OCIRCUIT_API_KEY` and `OCIRCUIT_API_BASE` from the
process environment. Explicitly exported values take precedence over values in
the file. Never commit `.env` or API keys.

## Usage

```bash
oc
```

The release tarball contains starter provider templates. Install them locally
when needed with:

```bash
oc init
```

Existing templates are never overwritten. Copy one to
`~/.ocircuit/config.yaml` or use it directly with `oc --config`.

The internal package includes `config-cisco-oauth.yaml` as a strict OAuth/OIDC
starting point. Replace its placeholder issuer, client ID, model, and endpoint
with approved provider values. The SDK authentication flow uses an ephemeral
loopback callback, S256 PKCE, state and nonce validation, issuer/JWKS checks,
form-encoded token exchange, expiry-aware refresh, and revocation on logout.
Tokens are memory-only by default; persistent integrations must supply an
OS-keychain-backed `SecureTokenStore`. This describes the generic SDK flow;
the internal Circuit CLI already supplies OS-backed persistence. Package installation has no provisioning
side effect—run `oc init` explicitly when you want to install templates.

### Headless Mode

Headless mode (`-p` flag) runs without an interactive terminal UI, making it perfect for:

- Scripts and automation
- CI/CD pipelines
- Docker containers
- other editor integrations
- Environments without a TTY

```bash
# Basic usage
oc -p "Generate a conventional commit name for the current git changes."

# With piped input
echo "Review this code" | oc -p

# JSON output for scripting
oc -p "Analyze the code" --format json

# Silent mode (strips thinking tags)
oc -p "Write a README" --silent
```

**TTY-less Environments**: Headless mode is designed to work in environments without a terminal (TTY), such as when called by another tool using terminal commands. The CLI will not attempt to read stdin or initialize the interactive UI when running in headless mode with a supplied prompt.

### Session Management

The CLI automatically saves your chat history for each terminal session. You can resume where you left off:

```bash
# Resume the last session in this terminal
oc --resume

# List recent sessions and choose one to resume
oc ls

# List sessions in JSON format (for scripting)
oc ls --json
```

## Command Line Options

- `-p`: Run in headless mode (no TUI)
- `--config <path>`: Specify agent configuration path
- `--resume`: Resume the last session for this terminal
- `<prompt>`: Optional prompt to start with

## Environment Variables

- `OCIRCUIT_CLI_DISABLE_COMMIT_SIGNATURE`: Disable adding the Open Circuit commit signature to generated commit messages
- `FORCE_NO_TTY`: Force TTY-less mode, prevents stdin reading (useful for testing and automation)

## Commands

- `oc`: Start an interactive chat session
- `oc ls`: List recent sessions with TUI selector to choose one to resume
- `oc init`: Install packaged provider templates and the internal protected profile
- `/init`: In an interactive session, inspect the current repository and
  generate `AGENTS.md` plus a review rule
- `oc login`: Authenticate with Open Circuit
- `oc logout`: Sign out of current session
- `oc remote`: Launch a remote instance
- `oc serve`: Start HTTP server mode

### Session Listing (`oc ls`)

Shows recent sessions, limited by screen height to ensure it fits on your terminal.

- `--json`: Output in JSON format for scripting (always shows 10 sessions)

## TTY-less Support

The CLI fully supports running in environments without a TTY (terminal):

```bash
# From Docker without TTY allocation
docker run --rm my-image oc -p "Generate docs"

# From CI/CD pipeline
oc -p "Review changes" --format json

# From an editor or automation terminal tool
oc -p "Analyze code" --silent
```

The CLI automatically detects TTY-less environments and adjusts its behavior:

- Skips stdin reading when a prompt is supplied
- Disables interactive UI components
- Ensures clean stdout/stderr output

For more details, see [`spec/tty-less-support.md`](./spec/tty-less-support.md).

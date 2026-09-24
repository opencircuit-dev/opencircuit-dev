# Open Circuit CLI

The Open Circuit CLI (`oc`) is a customizable command line coding agent.

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

## Usage

```bash
oc
```

Installation also creates starter provider templates in
`~/.ocircuit/templates/`. Existing templates are never overwritten. Copy one
to `~/.ocircuit/config.yaml` or use it directly with `oc --config`.

### Headless Mode

Headless mode (`-p` flag) runs without an interactive terminal UI, making it perfect for:

- Scripts and automation
- CI/CD pipelines
- Docker containers
- VSCode/IntelliJ extension integration
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

**TTY-less Environments**: Headless mode is designed to work in environments without a terminal (TTY), such as when called from VSCode/IntelliJ extensions using terminal commands. The CLI will not attempt to read stdin or initialize the interactive UI when running in headless mode with a supplied prompt.

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

# From VSCode/IntelliJ extension terminal tool
oc -p "Analyze code" --silent
```

The CLI automatically detects TTY-less environments and adjusts its behavior:

- Skips stdin reading when a prompt is supplied
- Disables interactive UI components
- Ensures clean stdout/stderr output

For more details, see [`spec/tty-less-support.md`](./spec/tty-less-support.md).

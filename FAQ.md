# Frequently asked questions

## Should I install the release tarball or build from source?

Install the release tarball if you want to use `oc`. Build from source only if
you are changing Open Circuit or need to validate an unreleased change. The
decision tree and checksum verification steps are in
[`QUICKSTART.md`](QUICKSTART.md).

## Why did `oc` disappear after I opened a new terminal?

Global npm binaries are installed under the active Node.js version. Reload NVM,
select the repository's Node version, and make it the default:

```bash
source "$NVM_DIR/nvm.sh"
nvm use 24.19.0
nvm alias default 24.19.0
command -v oc
```

## Where should I put provider keys?

Use `~/.ocircuit/.env` with the environment variable for the one active
provider, or export it for a single command. Never paste keys into a committed
YAML file or commit `.env`; see the provider section in `QUICKSTART.md`.

## How do I create repository guidance?

Start an interactive session in the repository and run `/init`. It asks the
assistant to inspect the project and create `AGENTS.md` plus a repository
review rule. A separate `oc init` process is not currently provided because
the existing flow needs the active session's repository context and write
tools. Use `oc -p` with an explicit prompt when you need a non-interactive,
review-only bootstrap.

## Which test command should I run?

Use the owning package's focused test command first. The repository-wide
test architecture and escalation rules are in [`TESTING.md`](TESTING.md).

## Where should new documentation go?

Use [`DOCUMENTATION.md`](DOCUMENTATION.md) to find the owning surface. Avoid
adding a second copy of setup or behavior instructions when a canonical guide
already exists.

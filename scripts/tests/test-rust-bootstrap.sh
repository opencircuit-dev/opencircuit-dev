#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
readonly BOOTSTRAP="${REPO_ROOT}/scripts/bootstrap-rust-toolchain.mjs"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

fixture_home="$(mktemp -d -t opencircuit-rust-bootstrap.XXXXXX)"
trap 'rm -rf -- "$fixture_home"' EXIT
mkdir -p -- "${fixture_home}/.cargo/bin"

cat >"${fixture_home}/.cargo/bin/rustc" <<'EOF'
#!/usr/bin/env bash
printf 'rustc 1.99.0 (fixture)\n'
EOF
cat >"${fixture_home}/.cargo/bin/cargo" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == 'audit --version' ]]; then
  printf 'cargo-audit-audit 0.22.2\n'
else
  printf 'cargo 1.99.0 (fixture)\n'
fi
EOF
cat >"${fixture_home}/.cargo/bin/rustfmt" <<'EOF'
#!/usr/bin/env bash
printf 'rustfmt 1.10.0-stable (fixture)\n'
EOF
chmod 700 "${fixture_home}/.cargo/bin/rustc" \
  "${fixture_home}/.cargo/bin/cargo" \
  "${fixture_home}/.cargo/bin/rustfmt"

output="$(HOME="${fixture_home}" \
  OC_RUST_BOOTSTRAP_PLATFORM_OVERRIDE=linux \
  node "${BOOTSTRAP}")"

printf '%s\n' "${output}" | python3 -c '
import json, sys
doc = json.load(sys.stdin)
assert doc["status"] == "pass"
assert doc["action_taken"] == "none"
assert all(item["passed"] for item in doc["versions"])
'

printf 'PASS: user-local Rust bootstrap is idempotent when the pinned toolchain is valid\n'

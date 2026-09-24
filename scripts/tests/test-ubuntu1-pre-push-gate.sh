#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
readonly GATE="$SCRIPT_DIR/../ubuntu1-pre-push-gate.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -x "$GATE" ]] || fail "gate is not executable: $GATE"

workspace="$(mktemp -d -t oc-pre-push-gate.XXXXXX)"
trap 'rm -rf -- "$workspace"' EXIT
repo="$workspace/repo"
orchestration="$workspace/orchestration"
counter="$workspace/invocations"

git init -q "$repo"
git -C "$repo" config user.name 'Test User'
git -C "$repo" config user.email 'test@example.invalid'
printf 'fixture\n' > "$repo/README.md"
git -C "$repo" add README.md
git -C "$repo" commit -qm 'fixture'

mkdir -p "$orchestration/scripts"
git init -q "$orchestration"
git -C "$orchestration" config user.name 'Test User'
git -C "$orchestration" config user.email 'test@example.invalid'
printf 'fixture\n' > "$orchestration/README.md"
git -C "$orchestration" add README.md
git -C "$orchestration" commit -qm 'fixture'
cat > "$orchestration/scripts/opencircuit-orchestration.sh" <<'ORCHESTRATOR'
#!/usr/bin/env bash
set -euo pipefail
printf 'run\n' >> "${OC_TEST_GATE_COUNTER:?}"
exit "${OC_TEST_GATE_EXIT:-0}"
ORCHESTRATOR
chmod +x "$orchestration/scripts/opencircuit-orchestration.sh"

sha="$(git -C "$repo" rev-parse HEAD)"
push_line="refs/heads/main $sha refs/heads/main 0000000000000000000000000000000000000000"

run_gate() {
  (
    cd "$repo"
    printf '%s\n' "$push_line" | \
      OC_ORCHESTRATION_ROOT="$orchestration" \
      OC_TEST_GATE_COUNTER="$counter" \
      "$GATE" origin git@github.com:brettconnor/opencircuit-dev.git
  )
}

# Disabled clones do not call Ubuntu1.
run_gate
[[ ! -e "$counter" ]] || fail 'disabled gate invoked orchestrator'

git -C "$repo" config --local ocircuit.ubuntu-gate true
git -C "$repo" config --local ocircuit.orchestration-root "$orchestration"

# A cache miss invokes the registered action and records its exact commit.
run_gate
[[ "$(wc -l < "$counter")" -eq 1 ]] || fail 'cache miss did not invoke orchestrator once'
cache_file="$repo/$(git -C "$repo" rev-parse --git-dir)/ocircuit/ubuntu1-validated-shas"
grep -q "^$sha " "$cache_file" || fail 'successful SHA was not cached'

# A cache hit skips another remote invocation.
run_gate
[[ "$(wc -l < "$counter")" -eq 1 ]] || fail 'cache hit invoked orchestrator'

# Bypass skips remote invocation and does not add a cache record.
rm -f "$cache_file"
(
  cd "$repo"
  printf '%s\n' "$push_line" | \
    OC_SKIP_UBUNTU_GATE=1 \
    OC_ORCHESTRATION_ROOT="$orchestration" \
    OC_TEST_GATE_COUNTER="$counter" \
    "$GATE" origin git@github.com:brettconnor/opencircuit-dev.git
)
[[ ! -e "$cache_file" ]] || fail 'bypass wrote cache data'
[[ "$(wc -l < "$counter")" -eq 1 ]] || fail 'bypass invoked orchestrator'

# Failed validation blocks a push and never adds the SHA to cache.
if (
  cd "$repo"
  printf '%s\n' "$push_line" | \
    OC_TEST_GATE_EXIT=1 \
    OC_ORCHESTRATION_ROOT="$orchestration" \
    OC_TEST_GATE_COUNTER="$counter" \
    "$GATE" origin git@github.com:brettconnor/opencircuit-dev.git
); then
  fail 'failed validation allowed push'
fi
[[ ! -e "$cache_file" ]] || fail 'failed validation wrote cache data'

# Tags and non-GitHub remotes are outside the gate scope.
(
  cd "$repo"
  printf 'refs/tags/v1.0.0 %s refs/tags/v1.0.0 0000000000000000000000000000000000000000\n' "$sha" | \
    OC_ORCHESTRATION_ROOT="$orchestration" \
    OC_TEST_GATE_COUNTER="$counter" \
    "$GATE" origin git@github.com:brettconnor/opencircuit-dev.git
)
(
  cd "$repo"
  printf '%s\n' "$push_line" | \
    OC_ORCHESTRATION_ROOT="$orchestration" \
    OC_TEST_GATE_COUNTER="$counter" \
    "$GATE" local /tmp/remote.git
)
[[ "$(wc -l < "$counter")" -eq 2 ]] || fail 'excluded refs or remotes invoked orchestrator'

printf 'ubuntu1 pre-push gate: PASS\n'
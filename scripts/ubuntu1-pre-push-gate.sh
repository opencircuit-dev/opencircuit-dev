#!/usr/bin/env sh

set -eu

log() {
  printf '[ubuntu1-pre-push] %s\n' "$*" >&2
}

is_enabled() {
  [ "$(git config --bool --get ocircuit.ubuntu-gate 2>/dev/null || true)" = "true" ]
}

is_github_remote() {
  case "$1" in
    *github.com*) return 0 ;;
    *) return 1 ;;
  esac
}

is_zero_sha() {
  case "$1" in
    0000000000000000000000000000000000000000) return 0 ;;
    *) return 1 ;;
  esac
}

if [ "${OC_SKIP_UBUNTU_GATE:-}" = "1" ]; then
  log 'skipping Ubuntu1 validation because OC_SKIP_UBUNTU_GATE=1'
  exit 0
fi

if ! is_enabled; then
  exit 0
fi

remote_name="${1:-}"
remote_url="${2:-}"
if [ -z "$remote_name" ] || [ -z "$remote_url" ]; then
  log 'missing Git pre-push remote arguments'
  exit 2
fi

if ! is_github_remote "$remote_url"; then
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
git_dir="$(git rev-parse --git-dir)"
case "$git_dir" in
  /*) ;;
  *) git_dir="$repo_root/$git_dir" ;;
esac

orchestration_root="${OC_ORCHESTRATION_ROOT:-$(git config --get ocircuit.orchestration-root 2>/dev/null || true)}"
if [ -z "$orchestration_root" ]; then
  log 'Ubuntu1 gate is enabled but ocircuit.orchestration-root is not configured'
  log 'set it with: git config --local ocircuit.orchestration-root /path/to/opencircuit-orchestration'
  exit 2
fi

orchestrator="$orchestration_root/scripts/opencircuit-orchestration.sh"
if [ ! -x "$orchestrator" ]; then
  log "orchestrator is not executable: $orchestrator"
  exit 2
fi

candidate_sha=''
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/*) ;;
    *) continue ;;
  esac

  if is_zero_sha "$local_sha"; then
    continue
  fi

  if [ -n "$candidate_sha" ] && [ "$candidate_sha" != "$local_sha" ]; then
    log 'cannot validate a push containing multiple branch commits in one invocation'
    log 'push one branch at a time or use OC_SKIP_UBUNTU_GATE=1 for an explicit emergency bypass'
    exit 2
  fi
  candidate_sha="$local_sha"
done

if [ -z "$candidate_sha" ]; then
  exit 0
fi

head_sha="$(git rev-parse HEAD)"
if [ "$candidate_sha" != "$head_sha" ]; then
  log "Ubuntu1 validation requires the pushed commit to be HEAD ($head_sha); got $candidate_sha"
  exit 2
fi

if [ -n "$(git status --porcelain)" ]; then
  log 'working tree must be clean before Ubuntu1 validation can synchronize the exact commit'
  exit 2
fi

orchestration_sha="$(git -C "$orchestration_root" rev-parse HEAD 2>/dev/null || true)"
if [ -z "$orchestration_sha" ]; then
  log "cannot resolve the orchestration revision at $orchestration_root"
  exit 2
fi

cache_dir="$git_dir/ocircuit"
cache_file="$cache_dir/ubuntu1-validated-shas"
mkdir -p -- "$cache_dir"

if [ -f "$cache_file" ] && awk -v sha="$candidate_sha" -v orchestration="$orchestration_sha" \
  '$1 == sha && $2 == orchestration { found = 1 } END { exit found ? 0 : 1 }' "$cache_file"; then
  log "Ubuntu1 already passed for $candidate_sha"
  exit 0
fi

log "validating $candidate_sha on Ubuntu1 before push to $remote_name"
if ! "$orchestrator" \
  --target ubuntu1 \
  --action opencircuit-dev-test-suite \
  --deployable opencircuit-dev-personal; then
  log 'Ubuntu1 validation failed; push blocked'
  exit 1
fi

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cache_temp="$cache_file.tmp.$$"
{
  printf '%s %s %s\n' "$candidate_sha" "$orchestration_sha" "$timestamp"
  if [ -f "$cache_file" ]; then
    tail -n 199 -- "$cache_file"
  fi
} > "$cache_temp"
mv -- "$cache_temp" "$cache_file"

log "Ubuntu1 validation passed for $candidate_sha"

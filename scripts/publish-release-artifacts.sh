#!/usr/bin/env bash
# Publish the source-version tarball + checksum from this repository's
# release-artifacts/ into a checkout of the public opencircuit-dev/opencircuit
# repository at its top level, preserve unrelated destination content,
# refresh the release docs, and optionally commit + push the result.
#
# Intended to run from a CI job that has already:
#   1. Built extensions/cli/release-artifacts/v<version>/... in this checkout
#      (see: npm --prefix extensions/cli run release:artifact)
#   2. Checked out opencircuit-dev/opencircuit into a separate local path
#
# Usage:
#   scripts/publish-release-artifacts.sh --dest <path> [--source <path>] [--artifact <verified-download>] [--push] [--no-commit]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REPO="$REPO_ROOT"
DEST_REPO=""
ARTIFACT=""
DO_PUSH=0
DO_COMMIT=1

while [ $# -gt 0 ]; do
  case "$1" in
    --dest)
      DEST_REPO="$2"
      shift 2
      ;;
    --source)
      SOURCE_REPO="$2"
      shift 2
      ;;
    --artifact)
      ARTIFACT="$2"
      shift 2
      ;;
    --push)
      DO_PUSH=1
      shift
      ;;
    --no-commit)
      DO_COMMIT=0
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$DEST_REPO" ]; then
  echo "error: --dest <path to opencircuit-dev/opencircuit checkout> is required" >&2
  exit 1
fi
DEST_REPO="$(cd "$DEST_REPO" && pwd)"

declare -a refresh_args=(--source "$SOURCE_REPO" --dest "$DEST_REPO")
[[ -z "$ARTIFACT" ]] || refresh_args+=(--artifact "$ARTIFACT")
latest_version="$(python3 "$REPO_ROOT/scripts/refresh-cli-release.py" "${refresh_args[@]}")"
echo "Refreshed verified v${latest_version} artifacts and public documentation."

if [ "$DO_COMMIT" -eq 1 ]; then
  cd "$DEST_REPO"
  git add -A -- ./
  # The destination checkout is dedicated to published artifacts; stage the
  # whole tree so removal of a previously tracked release-artifacts/ directory
  # is included even after the directory no longer exists.
  if ! git diff --cached --quiet; then
    git commit -m "Publish release artifacts ${latest_version:-update}"
    echo "Committed release artifact publish."
  else
    echo "No changes to commit."
  fi
fi

if [ "$DO_PUSH" -eq 1 ]; then
  cd "$DEST_REPO"
  git push origin HEAD
  echo "Pushed to origin."
fi

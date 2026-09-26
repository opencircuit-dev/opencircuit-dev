#!/usr/bin/env bash
# Publish the newest staged tarball + checksum from this repository's
# release-artifacts/ into a checkout of the public opencircuit-dev/opencircuit
# repository at its top level, remove any destination staging directory,
# refresh the release docs, and optionally commit + push the result.
#
# Intended to run from a CI job that has already:
#   1. Built extensions/cli/release-artifacts/v<version>/... in this checkout
#      (see: npm --prefix extensions/cli run release:artifact)
#   2. Checked out opencircuit-dev/opencircuit into a separate local path
#
# Usage:
#   scripts/publish-release-artifacts.sh --dest <path> [--source <path>] [--push] [--no-commit]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REPO="$REPO_ROOT"
DEST_REPO=""
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

SRC_ARTIFACTS="$SOURCE_REPO/release-artifacts"
DEST_ARTIFACTS="$DEST_REPO/release-artifacts"

if [ ! -d "$SRC_ARTIFACTS" ]; then
  echo "error: no release-artifacts directory found at $SRC_ARTIFACTS" >&2
  echo "       run 'npm --prefix extensions/cli run release:artifact' first" >&2
  exit 1
fi

echo "Publishing release artifacts"
echo "  from: $SRC_ARTIFACTS"
echo "  to:   $DEST_ARTIFACTS"

# Determine the newest version directory and publish its tarball + checksum
# directly at the destination repository root.
latest_dir="$(find "$SRC_ARTIFACTS" -mindepth 1 -maxdepth 1 -type d | sort -rV | head -n1)"
if [ -z "$latest_dir" ]; then
  echo "error: no version directories found under $SRC_ARTIFACTS" >&2
  exit 1
fi
latest_version="$(basename "$latest_dir")"
latest_tgz="$(find "$latest_dir" -maxdepth 1 -name '*.tgz' | head -n1)"
if [ -z "$latest_tgz" ]; then
  echo "error: no .tgz found in $latest_dir" >&2
  exit 1
fi
latest_name="$(basename "$latest_tgz")"
if [ ! -f "$latest_tgz.sha256" ]; then
  echo "error: missing checksum for $latest_tgz" >&2
  exit 1
fi

# Remove the historical directory from the public distribution repo.
if [ -e "$DEST_ARTIFACTS" ]; then
  rm -rf -- "$DEST_ARTIFACTS"
fi

# Remove any stale top-level tarball/checksum from a previous version before
# copying the current latest one into place.
find "$DEST_REPO" -maxdepth 1 -name 'opencircuit-cli-*.tgz' -delete
find "$DEST_REPO" -maxdepth 1 -name 'opencircuit-cli-*.tgz.sha256' -delete
cp "$latest_tgz" "$DEST_REPO/"
cp "$latest_tgz.sha256" "$DEST_REPO/"
echo "Mirrored latest ($latest_version) artifact to repository root: $latest_name"

# Rebuild the versions table between the README markers.
README="$DEST_REPO/README.md"
VERSIONS_TABLE=$(
  {
    echo "| Version | Artifact | Checksum |"
    echo "| ------- | -------- | -------- |"
    echo "| \`$latest_version\` | [\`$latest_name\`]($latest_name) | [\`$latest_name.sha256\`]($latest_name.sha256) |"
  }
)

python3 - "$README" "$VERSIONS_TABLE" <<'PY'
import sys

readme_path, table = sys.argv[1], sys.argv[2]
start_marker = "<!-- VERSIONS_TABLE_START -->"
end_marker = "<!-- VERSIONS_TABLE_END -->"

with open(readme_path, encoding="utf-8") as f:
    content = f.read()

start = content.index(start_marker) + len(start_marker)
end = content.index(end_marker)
content = content[:start] + "\n\n" + table + "\n\n" + content[end:]

with open(readme_path, "w", encoding="utf-8") as f:
    f.write(content)
PY

echo "Updated $README versions table."

python3 - "$README" "$latest_name" <<'PY'
import sys

readme_path, artifact_name = sys.argv[1], sys.argv[2]
start_marker = "<!-- LATEST_ARTIFACT_START -->"
end_marker = "<!-- LATEST_ARTIFACT_END -->"
with open(readme_path, encoding="utf-8") as f:
    content = f.read()
start = content.index(start_marker) + len(start_marker)
end = content.index(end_marker)
replacement = (
    f"\n\n- [`{artifact_name}`]({artifact_name})\n"
    f"- [`{artifact_name}.sha256`]({artifact_name}.sha256)\n\n"
)
content = content[:start] + replacement + content[end:]
with open(readme_path, "w", encoding="utf-8") as f:
    f.write(content)
PY

echo "Updated $README latest artifact links."

QUICKSTART="$DEST_REPO/QUICKSTART.md"
python3 - "$QUICKSTART" "$latest_name" <<'PY'
import sys

quickstart_path, artifact_name = sys.argv[1], sys.argv[2]
start_marker = "<!-- LATEST_ARTIFACT_START -->"
end_marker = "<!-- LATEST_ARTIFACT_END -->"
with open(quickstart_path, encoding="utf-8") as f:
    content = f.read()
start = content.index(start_marker) + len(start_marker)
end = content.index(end_marker)
replacement = (
    "\n\nFor the newest release, download the root-level bundle and checksum:\n\n"
    f"- [`{artifact_name}`]({artifact_name})\n"
    f"- [`{artifact_name}.sha256`]({artifact_name}.sha256)\n\n"
)
content = content[:start] + replacement + content[end:]
with open(quickstart_path, "w", encoding="utf-8") as f:
    f.write(content)
PY

echo "Updated $QUICKSTART latest artifact links."

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

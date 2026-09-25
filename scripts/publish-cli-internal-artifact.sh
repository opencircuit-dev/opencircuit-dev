#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=""
DEST_REPO=""
DO_PUSH=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source)
      [ "$#" -ge 2 ] || { echo "error: --source requires a path" >&2; exit 2; }
      SOURCE_DIR="$2"
      shift 2
      ;;
    --dest)
      [ "$#" -ge 2 ] || { echo "error: --dest requires a path" >&2; exit 2; }
      DEST_REPO="$2"
      shift 2
      ;;
    --push)
      DO_PUSH=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$SOURCE_DIR" ] || [ -z "$DEST_REPO" ]; then
  echo "Usage: $0 --source <artifact-directory> --dest <repository-checkout> [--push]" >&2
  exit 2
fi

SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
DEST_REPO="$(git -C "$DEST_REPO" rev-parse --show-toplevel)"
origin_url="$(git -C "$DEST_REPO" remote get-url origin)"
if [[ ! "$origin_url" =~ wwwin-github\.cisco\.com[:/]opencircuit-dev/opencircuit-internal(\.git)?$ ]]; then
  echo "error: destination origin must be opencircuit-dev/opencircuit-internal on wwwin-github.cisco.com" >&2
  exit 1
fi

shopt -s nullglob
artifacts=("$SOURCE_DIR"/opencircuit-cli-internal-*.tgz)
if [ "${#artifacts[@]}" -ne 1 ]; then
  echo "error: expected exactly one internal CLI tarball in $SOURCE_DIR" >&2
  exit 1
fi

artifact_path="${artifacts[0]}"
artifact_name="$(basename "$artifact_path")"
if [[ ! "$artifact_name" =~ ^opencircuit-cli-internal-([0-9]+\.[0-9]+\.[0-9]+)\.tgz$ ]]; then
  echo "error: unexpected internal CLI artifact name: $artifact_name" >&2
  exit 1
fi
version="${BASH_REMATCH[1]}"
checksum_name="$artifact_name.sha256"
checksum_path="$SOURCE_DIR/$checksum_name"
if [ ! -f "$checksum_path" ]; then
  echo "error: missing checksum file: $checksum_path" >&2
  exit 1
fi
(
  cd "$SOURCE_DIR"
  shasum -a 256 -c "$checksum_name"
)

branch="$(git -C "$DEST_REPO" symbolic-ref --short HEAD)"
if [ -z "$branch" ]; then
  echo "error: destination checkout must be on a branch before publishing" >&2
  exit 1
fi

# Keep only the current version at the repository root; prior versions remain
# available in the destination repository's commit history.
find "$DEST_REPO" -maxdepth 1 -type f \
  \( -name 'opencircuit-cli-internal-*.tgz' -o -name 'opencircuit-cli-internal-*.tgz.sha256' \) \
  -delete
cp "$artifact_path" "$DEST_REPO/$artifact_name"
cp "$checksum_path" "$DEST_REPO/$checksum_name"

git -C "$DEST_REPO" add -A -- 'opencircuit-cli-internal-*.tgz' 'opencircuit-cli-internal-*.tgz.sha256'
if ! git -C "$DEST_REPO" diff --cached --quiet; then
  git -C "$DEST_REPO" config user.name "github-actions[bot]"
  git -C "$DEST_REPO" config user.email "github-actions[bot]@users.noreply.github.com"
  git -C "$DEST_REPO" commit -m "Publish internal CLI artifact $version"
  echo "Committed internal CLI artifact $version."
else
  echo "Internal CLI artifact $version is already up to date."
fi

if [ "$DO_PUSH" -eq 1 ]; then
  git -C "$DEST_REPO" push origin "HEAD:refs/heads/$branch"
  echo "Pushed internal CLI artifact $version to $branch."
fi

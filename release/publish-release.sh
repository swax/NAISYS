#!/usr/bin/env bash
set -euo pipefail

# Publish all packages to npm as a stable release.
# Usage: ./release/publish-release.sh

source "$(dirname "$0")/_publish-helpers.sh"
cd "$ROOT"

VERSION=$(node -e "console.log(require('./package.json').version)")

if [[ "$VERSION" == *-* ]]; then
  echo "Error: Current version ($VERSION) is a prerelease."
  echo "Set a stable version first: $SCRIPTS/set-version.sh $VERSION <stable-version>"
  exit 1
fi

collect_packages

echo "=== Publish Release ==="
echo "Will publish version $VERSION for:"
show_packages "$VERSION"

confirm_or_exit

setup_readme
trap "restore_readme" EXIT

build_and_format
publish_packages

echo ""
echo "=== Done! Published $VERSION ==="

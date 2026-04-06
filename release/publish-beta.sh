#!/usr/bin/env bash
set -euo pipefail

# Publish all packages to npm with a beta tag.
# Usage: ./release/publish-beta.sh [beta-number]
# Example: ./release/publish-beta.sh 3   →  3.0.0-beta.3
# Default beta number is 0.

source "$(dirname "$0")/_publish-helpers.sh"
cd "$ROOT"

BETA_NUM="${1:-0}"
BASE_VERSION=$(node -e "console.log(require('./package.json').version)")
BETA_VERSION="$BASE_VERSION-beta.$BETA_NUM"

if [[ "$BASE_VERSION" == *-* ]]; then
  echo "Error: Current version ($BASE_VERSION) is already a prerelease."
  echo "Reset to a stable version first: $SCRIPTS/set-version.sh $BASE_VERSION <stable-version>"
  exit 1
fi

collect_packages

echo "=== Publish Beta ==="
echo "Will publish version $BETA_VERSION for:"
show_packages "$BETA_VERSION"

confirm_or_exit

"$SCRIPTS/set-version.sh" "$BASE_VERSION" "$BETA_VERSION"

# Always revert versions and readme, even if build or publish fails
trap "restore_readme; $SCRIPTS/set-version.sh $BETA_VERSION $BASE_VERSION; echo; echo '=== Reverted version bumps ==='" EXIT

setup_readme
build_and_format
publish_packages beta

# Deprecate previous beta if it exists
if [[ "$BETA_NUM" -gt 0 ]]; then
  "$SCRIPTS/deprecate-beta.sh" "$((BETA_NUM - 1))" "superseded by $BETA_VERSION" "$BASE_VERSION"
fi

echo ""
echo "=== Done! Install with: npm install -g naisys@beta ==="

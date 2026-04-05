#!/usr/bin/env bash
set -euo pipefail

# Publish all packages to npm with a beta tag.
# Usage: ./scripts/publish-beta.sh [beta-number]
# Example: ./scripts/publish-beta.sh 3   →  3.0.0-beta.3
# Default beta number is 0.

BETA_NUM="${1:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/scripts"
cd "$ROOT"

# Get the current version from the root package.json
BASE_VERSION=$(node -e "console.log(require('./package.json').version)")
BETA_VERSION="$BASE_VERSION-beta.$BETA_NUM"

# Don't append -beta if it's already a prerelease
if [[ "$BASE_VERSION" == *-* ]]; then
  echo "Error: Current version ($BASE_VERSION) is already a prerelease."
  echo "Reset to a stable version first: $SCRIPTS/set-version.sh $BASE_VERSION <stable-version>"
  exit 1
fi

echo "=== Publish Beta ==="
echo "  $BASE_VERSION → $BETA_VERSION"
echo ""

read -p "Continue? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Cancelled."
  exit 0
fi

# Step 1: Bump versions
"$SCRIPTS/set-version.sh" "$BASE_VERSION" "$BETA_VERSION"

# Step 2: Clean and build
echo ""
echo "=== Building ==="
npm run clean
npm run build

# Step 3: Publish with --tag beta
echo ""
echo "=== Publishing ==="
npm run npm:publish --workspaces --if-present -- --tag beta

# Step 4: Revert version changes
echo ""
echo "=== Reverting version bumps ==="
"$SCRIPTS/set-version.sh" "$BETA_VERSION" "$BASE_VERSION"

echo ""
echo "=== Done! Install with: npm install -g naisys@beta ==="

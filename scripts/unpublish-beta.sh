#!/usr/bin/env bash
set -euo pipefail

# Unpublish all beta packages from npm.
# Usage: ./scripts/unpublish-beta.sh <beta-number>
# Example: ./scripts/unpublish-beta.sh 1   →  unpublishes 3.0.0-beta.1

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <beta-number>"
  echo "Example: $0 1"
  exit 1
fi

BETA_NUM="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_VERSION=$(node -e "console.log(require('./package.json').version)")
BETA_VERSION="$BASE_VERSION-beta.$BETA_NUM"

# Collect publishable package names
PACKAGES=$(grep -rl '"npm:publish"' --include='package.json' . | grep -v node_modules)
NAMES=()
for f in $PACKAGES; do
  NAMES+=($(node -e "console.log(require('./$f').name)"))
done

echo "=== Unpublish Beta ==="
echo "Will unpublish version $BETA_VERSION for:"
for name in "${NAMES[@]}"; do
  echo "  $name@$BETA_VERSION"
done
echo ""

read -p "Continue? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Cancelled."
  exit 0
fi

echo ""
for name in "${NAMES[@]}"; do
  echo "Unpublishing $name@$BETA_VERSION..."
  npm unpublish "$name@$BETA_VERSION" 2>&1 || echo "  (skipped — may not exist)"
done

echo ""
echo "=== Done ==="

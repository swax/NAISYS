#!/usr/bin/env bash
set -euo pipefail

# Deprecate all beta packages on npm.
# Usage: ./scripts/deprecate-beta.sh <beta-number> [message]
# Example: ./scripts/deprecate-beta.sh 1
# Example: ./scripts/deprecate-beta.sh 5 "superseded by 3.0.0-beta.6"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <beta-number> [message]"
  echo "Example: $0 1"
  exit 1
fi

source "$(dirname "$0")/_publish-helpers.sh"
cd "$ROOT"

BETA_NUM="$1"
BASE_VERSION=$(node -e "console.log(require('./package.json').version)")
BETA_VERSION="$BASE_VERSION-beta.$BETA_NUM"
MESSAGE="${2:-deprecated beta}"

collect_packages

echo "=== Deprecating $BETA_VERSION ==="

# Run all deprecations in parallel
pids=()
for name in "${PACKAGE_NAMES[@]}"; do
  npm deprecate "$name@$BETA_VERSION" "$MESSAGE" 2>/dev/null &
  pids+=($!)
done

for pid in "${pids[@]}"; do
  wait "$pid" || true
done

echo "Done."

#!/usr/bin/env bash
set -euo pipefail

# Deprecate all beta packages on npm.
# Usage: ./release/deprecate-beta.sh <beta-number> [message] [base-version]
# Example: ./release/deprecate-beta.sh 1
# Example: ./release/deprecate-beta.sh 5 "superseded by 3.0.0-beta.6"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <beta-number> [message] [base-version]"
  echo "Example: $0 1"
  exit 1
fi

source "$(dirname "$0")/_publish-helpers.sh"
cd "$ROOT"

BETA_NUM="$1"
MESSAGE="${2:-deprecated beta}"
BASE_VERSION="${3:-$(node -e "console.log(require('./package.json').version)")}"
BETA_VERSION="$BASE_VERSION-beta.$BETA_NUM"

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

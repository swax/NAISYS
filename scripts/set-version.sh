#!/usr/bin/env bash
set -euo pipefail

# Replace one version string with another across all package.json files.
# Usage: ./scripts/set-version.sh <from> <to>
# Example: ./scripts/set-version.sh 3.0.0 3.0.0-beta.1

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <from-version> <to-version>"
  echo "Example: $0 3.0.0 3.0.0-beta.1"
  exit 1
fi

FROM="$1"
TO="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Find all package.json files (excluding node_modules)
FILES=$(grep -rl "\"$FROM\"" --include='package.json' "$ROOT" | grep -v node_modules || true)

if [[ -z "$FILES" ]]; then
  echo "No package.json files contain version \"$FROM\""
  exit 1
fi

echo "Replacing \"$FROM\" → \"$TO\" in:"
for f in $FILES; do
  echo "  ${f#$ROOT/}"
  sed -i "s|\"$FROM\"|\"$TO\"|g" "$f"
done

echo "Done."

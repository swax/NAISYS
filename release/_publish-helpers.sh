#!/usr/bin/env bash
# Shared helpers for publish scripts. Source this file, don't execute it.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/release"

# Populates PACKAGE_DIRS and PACKAGE_NAMES arrays with publishable packages
# in workspace order (dependency order from root package.json).
collect_packages() {
  PACKAGE_DIRS=()
  PACKAGE_NAMES=()

  # Read workspace order from root package.json
  local workspaces
  workspaces=$(node -e "
    const ws = require('$ROOT/package.json').workspaces;
    ws.forEach(w => console.log(w));
  ")

  while IFS= read -r ws; do
    local pkg="$ROOT/$ws/package.json"
    # Only include workspaces that have an npm:publish script
    if [[ -f "$pkg" ]] && grep -q '"npm:publish"' "$pkg"; then
      PACKAGE_DIRS+=("$ROOT/$ws")
      PACKAGE_NAMES+=($(node -e "console.log(require('$pkg').name)"))
    fi
  done <<< "$workspaces"
}

# Prints each package@version
show_packages() {
  local version="$1"
  for name in "${PACKAGE_NAMES[@]}"; do
    echo "  $name@$version"
  done
}

# Prompts for confirmation, exits on decline
confirm_or_exit() {
  echo ""
  read -p "Continue? (y/N) " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Cancelled."
    exit 0
  fi
}

# Copy root README to the naisys package so npm shows the project overview
setup_readme() {
  cp "$ROOT/apps/naisys/README.md" "$ROOT/apps/naisys/README.md.bak"
  cp "$ROOT/README.md" "$ROOT/apps/naisys/README.md"
}

restore_readme() {
  if [[ -f "$ROOT/apps/naisys/README.md.bak" ]]; then
    mv "$ROOT/apps/naisys/README.md.bak" "$ROOT/apps/naisys/README.md"
  fi
}

# Clean, build, and format dist for readability
build_and_format() {
  echo ""
  echo "=== Building ==="
  npm run clean
  npm run build

  # echo ""
  # echo "=== Formatting dist ==="
  # npx prettier --write "**/dist/**/*.js" --ignore-path /dev/null --log-level warn
}

# Publish all workspaces individually, optionally with a dist-tag.
# Publishes in dependency order. Continues past failures and reports them at the end.
publish_packages() {
  local tag_args=()
  if [[ $# -gt 0 ]]; then
    tag_args=(--tag "$1")
  fi

  echo ""
  echo "=== Publishing ==="

  local failed=()
  for i in "${!PACKAGE_DIRS[@]}"; do
    local dir="${PACKAGE_DIRS[$i]}"
    local name="${PACKAGE_NAMES[$i]}"
    echo ""
    echo "--- $name ---"
    if ! npm publish --access public "${tag_args[@]}" --workspace "$dir" 2>&1; then
      failed+=("$name")
    fi
  done

  echo ""
  if [[ ${#failed[@]} -gt 0 ]]; then
    echo "=== WARNING: ${#failed[@]} package(s) failed to publish ==="
    for name in "${failed[@]}"; do
      echo "  - $name"
    done
    echo ""
    echo "Re-run the failed publishes manually or retry the script."
    return 1
  else
    echo "=== All packages published successfully ==="
  fi
}

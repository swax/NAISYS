#!/usr/bin/env bash
# Shared helpers for publish scripts. Source this file, don't execute it.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/release"

# Packages end-users install directly. Each gets an npm-shrinkwrap.json at
# publish time to pin all transitive deps. Library packages installed only as
# transitive deps are covered by these shrinkwraps, so they don't need their own.
LEAF_PACKAGES=(
  "naisys"
  "@naisys/hub"
  "@naisys/supervisor"
  "@naisys/erp"
)

is_leaf_package() {
  local name="$1"
  for leaf in "${LEAF_PACKAGES[@]}"; do
    [[ "$name" == "$leaf" ]] && return 0
  done
  return 1
}

# Generate npm-shrinkwrap.json for a package by resolving its deps in an
# isolated temp dir (outside the workspace). --prefer-offline reuses the npm
# cache populated by the most recent `npm install` at the workspace root, so
# transitive deps resolve to the same versions you tested with rather than
# whatever's latest on the registry at publish time. Workspace sibling deps
# get fetched from npm (cache miss) — they were published earlier in the loop.
generate_shrinkwrap() {
  local pkg_dir="$1"
  local tmp_dir
  tmp_dir=$(mktemp -d)

  cp "$pkg_dir/package.json" "$tmp_dir/package.json"

  (
    cd "$tmp_dir"
    npm install --package-lock-only --prefer-offline --ignore-scripts --omit=dev >/dev/null
  ) || {
    rm -rf "$tmp_dir"
    return 1
  }

  mv "$tmp_dir/package-lock.json" "$pkg_dir/npm-shrinkwrap.json"
  rm -rf "$tmp_dir"
}

# Remove any npm-shrinkwrap.json files in leaf packages. Safe to call multiple
# times — use from EXIT traps to guarantee cleanup on abnormal exits.
cleanup_all_shrinkwraps() {
  for i in "${!PACKAGE_DIRS[@]}"; do
    local name="${PACKAGE_NAMES[$i]}"
    local dir="${PACKAGE_DIRS[$i]}"
    if is_leaf_package "$name"; then
      rm -f "$dir/npm-shrinkwrap.json"
    fi
  done
}

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

    local generated_shrinkwrap=0
    if is_leaf_package "$name"; then
      echo "Generating npm-shrinkwrap.json..."
      if generate_shrinkwrap "$dir"; then
        generated_shrinkwrap=1
      else
        echo "ERROR: Failed to generate shrinkwrap for $name"
        failed+=("$name")
        continue
      fi
    fi

    if ! npm publish --access public "${tag_args[@]}" --workspace "$dir" 2>&1; then
      failed+=("$name")
    fi

    if [[ "$generated_shrinkwrap" == "1" ]]; then
      rm -f "$dir/npm-shrinkwrap.json"
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

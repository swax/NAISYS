#!/usr/bin/env bash
# Shared helpers for publish scripts. Source this file, don't execute it.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/release"
NPM_VISIBILITY_MAX_ATTEMPTS="${NPM_VISIBILITY_MAX_ATTEMPTS:-12}"
NPM_VISIBILITY_RETRY_SECONDS="${NPM_VISIBILITY_RETRY_SECONDS:-3}"

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
# whatever's latest on the registry at publish time. Workspace sibling deps are
# handled separately by waiting for published library packages to appear on npm
# before any leaf shrinkwraps are generated. That online metadata check also
# refreshes the shared npm cache that the later --prefer-offline install reads.
generate_shrinkwrap() {
  local pkg_dir="$1"
  local tmp_dir
  tmp_dir=$(mktemp -d)

  # Strip devDependencies from the temp package.json before generating the
  # lockfile. Under --omit=dev, npm lists dev deps but skips fetching resolution
  # info for their platform-specific optionalDependencies, leaving stub entries
  # without resolved/integrity. End users then get "invalid or damaged lockfile"
  # warnings on install, one per stub. Removing dev deps entirely avoids that.
  SRC_PKG="$pkg_dir/package.json" DST_PKG="$tmp_dir/package.json" node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync(process.env.SRC_PKG, "utf8"));
    delete pkg.devDependencies;
    fs.writeFileSync(process.env.DST_PKG, JSON.stringify(pkg, null, 2) + "\n");
  '

  local install_output
  if ! install_output=$(cd "$tmp_dir" && npm install --package-lock-only --prefer-offline --ignore-scripts 2>&1); then
    echo "$install_output" >&2
    rm -rf "$tmp_dir"
    return 1
  fi

  mv "$tmp_dir/package-lock.json" "$pkg_dir/npm-shrinkwrap.json"
  rm -rf "$tmp_dir"
}

# Wait until a just-published package version is visible in npm registry
# metadata. This both synchronizes with registry propagation and refreshes the
# local packument cache consulted by later --prefer-offline shrinkwrap installs.
wait_for_registry_version() {
  local name="$1"
  local version="$2"
  local attempt=1

  while :; do
    if npm view --prefer-online "$name@$version" version >/dev/null 2>&1; then
      return 0
    fi
    if [[ $attempt -ge $NPM_VISIBILITY_MAX_ATTEMPTS ]]; then
      return 1
    fi
    echo "  $name@$version not visible on npm yet ($attempt/$NPM_VISIBILITY_MAX_ATTEMPTS), retrying in ${NPM_VISIBILITY_RETRY_SECONDS}s..."
    sleep "$NPM_VISIBILITY_RETRY_SECONDS"
    attempt=$((attempt + 1))
  done
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
# Publishes in dependency order. Library packages are polled on npm after
# publish so leaf shrinkwrap generation does not race registry propagation.
# Continues past ordinary publish failures, but aborts on propagation timeout to
# avoid turning one stale packument into a cascade of downstream ETARGET errors.
publish_packages() {
  local tag_args=()
  if [[ $# -gt 0 ]]; then
    tag_args=(--tag "$1")
  fi

  echo ""
  echo "=== Publishing ==="

  local issues=()
  local aborted_due_to_propagation=0
  local abort_reason=""
  for i in "${!PACKAGE_DIRS[@]}"; do
    local dir="${PACKAGE_DIRS[$i]}"
    local name="${PACKAGE_NAMES[$i]}"
    local version
    version=$(node -e "console.log(require('$dir/package.json').version)")
    echo ""
    echo "--- $name ---"

    if is_leaf_package "$name"; then
      echo "Generating npm-shrinkwrap.json..."
      if ! generate_shrinkwrap "$dir"; then
        echo "ERROR: Failed to generate shrinkwrap for $name"
        issues+=("$name")
        continue
      fi
    fi

    if ! npm publish --access public "${tag_args[@]}" --workspace "$dir" 2>&1; then
      issues+=("$name")
    elif ! is_leaf_package "$name"; then
      echo "Waiting for $name@$version to appear on npm..."
      if ! wait_for_registry_version "$name" "$version"; then
        echo "ERROR: $name@$version did not appear on npm in time"
        issues+=("$name")
        aborted_due_to_propagation=1
        abort_reason="$name@$version did not appear on npm within $((NPM_VISIBILITY_MAX_ATTEMPTS * NPM_VISIBILITY_RETRY_SECONDS))s"
        break
      fi
    fi

    if is_leaf_package "$name"; then
      rm -f "$dir/npm-shrinkwrap.json"
    fi
  done

  echo ""
  if [[ ${#issues[@]} -gt 0 ]]; then
    echo "=== WARNING: ${#issues[@]} package(s) had publish issues ==="
    for name in "${issues[@]}"; do
      echo "  - $name"
    done
    echo ""
    if [[ "$aborted_due_to_propagation" == "1" ]]; then
      echo "Publish loop aborted after registry propagation timeout to avoid cascading downstream failures."
      echo "Root cause: $abort_reason"
      echo ""
    fi
    echo "Re-run the affected publishes manually or retry the script."
    return 1
  else
    echo "=== All packages published successfully ==="
  fi
}

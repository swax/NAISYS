# Publishing

[← Back to main README](../README.md)

### Pre-release check

Always run before publishing. Refreshes lockfile, audits runtime deps, builds, and tests:

```bash
npm run release:check
```

### Beta

Publish all packages with a beta dist-tag. Version is auto-derived from the root `package.json`.

```bash
# Publishes as 3.0.0-beta.1
./release/publish-beta.sh 1
```

This temporarily bumps all versions to the beta tag, publishes, then reverts. Automatically deprecates the previous beta number. Install with:

```bash
npm install -g naisys@beta @naisys/hub@beta @naisys/supervisor@beta @naisys/erp@beta
```

### Release

Publish all packages as a stable release using the current version in `package.json`.

```bash
./release/publish-release.sh
```

### Deprecate Beta

Mark a specific beta version as deprecated across all packages.

```bash
./release/deprecate-beta.sh 5                          # Deprecates 3.0.0-beta.5
./release/deprecate-beta.sh 5 "use beta.6 instead"    # Custom message
```

## Versioning

### set-version.sh

Find-and-replace a version string across all `package.json` files in the repo.

```bash
./release/set-version.sh 3.0.0 4.0.0
```

## Notes

- All publish scripts show the full list of packages and versions before prompting for confirmation.
- During publish, an `npm-shrinkwrap.json` is generated and shipped with each leaf package (`naisys`, `@naisys/hub`, `@naisys/supervisor`, `@naisys/erp`) to pin all transitive dependency versions for end-user installs. Files are generated in an isolated temp dir per package and deleted after publish (gitignored). The publish loop runs in dependency order, and it waits for each published library package to appear in npm metadata before any leaf shrinkwraps are generated. If a library still is not visible after the retry budget, the loop aborts there to avoid cascading downstream `ETARGET` failures.
- Shrinkwrap generation uses `npm install --prefer-offline`, which reuses the npm cache populated by your most recent `npm install` at the workspace root. **Run `npm run release:check` before publishing** — it does the install (priming the cache) plus audit/build/test, so shrinkwrap pins to versions you actually tested with while still letting freshly published internal packages propagate separately.
- Registry visibility retries default to 12 attempts with a 3 second delay (`NPM_VISIBILITY_MAX_ATTEMPTS`, `NPM_VISIBILITY_RETRY_SECONDS`) if you need a longer budget during npm incidents.

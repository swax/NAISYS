# Publishing

### Pre-release check

Always run before publishing. Refreshes lockfile, audits runtime deps, builds, and tests:

```bash
npm run release:check
```

### Beta

Publish all packages with a beta dist-tag. Version is auto-derived from the root `package.json`.

```bash
# Publishes as 3.0.0-beta.1
npm run release:beta 1
```

This temporarily bumps all versions to the beta tag, publishes, then reverts. Automatically deprecates the previous beta number. Install with:

```bash
npm install -g naisys@beta @naisys/hub@beta @naisys/supervisor@beta @naisys/erp@beta
```

### Release

Publish all packages as a stable release using the current version in `package.json`.

```bash
npm run release:publish
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
- During publish, an `npm-shrinkwrap.json` is generated and shipped with each leaf package (`naisys`, `@naisys/hub`, `@naisys/supervisor`, `@naisys/erp`) to pin all transitive dependency versions for end-user installs. Files are generated in an isolated temp dir per package and deleted after publish (gitignored). The publish loop runs in dependency order so workspace siblings are already on npm by the time a leaf needs them.
- Shrinkwrap generation uses `npm install --prefer-offline`, which reuses the npm cache populated by your most recent `npm install` at the workspace root. **Run `npm run release:check` before publishing** — it does the install (priming the cache) plus audit/build/test, so shrinkwrap pins to versions you actually tested with.

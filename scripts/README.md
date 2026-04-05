# Scripts

## Publishing

### Beta

Publish all packages with a beta dist-tag. Version is auto-derived from the root `package.json`.

```bash
# Publishes as 3.0.0-beta.0 (default)
npm run publish:beta

# Publishes as 3.0.0-beta.5
./scripts/publish-beta.sh 5
```

This temporarily bumps all versions to the beta tag, publishes, then reverts. Automatically deprecates the previous beta number. Install with:

```bash
npm install -g naisys@beta @naisys/hub@beta @naisys/supervisor@beta @naisys/erp@beta
```

### Release

Publish all packages as a stable release using the current version in `package.json`.

```bash
npm run publish:release
```

### Deprecate Beta

Mark a specific beta version as deprecated across all packages.

```bash
npm run deprecate:beta -- 5                          # Deprecates 3.0.0-beta.5
./scripts/deprecate-beta.sh 5 "use beta.6 instead"  # Custom message
```

## Versioning

### set-version.sh

Find-and-replace a version string across all `package.json` files in the repo.

```bash
./scripts/set-version.sh 3.0.0 4.0.0
```

## Notes

- All publish scripts show the full list of packages and versions before prompting for confirmation.
- Built JS in `dist/` is formatted with prettier before publishing so it's readable when stepping through in a debugger.

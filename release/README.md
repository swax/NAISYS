# Publishing

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

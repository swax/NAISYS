# Security maintenance

Keep the deployed Node runtime and the npm dependency lockfile patched. Updating
one does not update the other, and a running Node process keeps its old runtime
until it is restarted.

## Dependencies

Use the npm version in the root `packageManager` field. Commit workspace manifests
and `package-lock.json` together, and deploy with `npm ci` rather than resolving
new package versions on the production server.

`npm run security:audit` checks the complete lockfile, including development tools,
and fails for high or critical advisories. The dependency-security GitHub Actions
workflow runs this check on dependency pull requests, pushes to main, and daily.
It does not install project dependencies or run their lifecycle scripts.
On pull requests and dependency pushes, a separate job builds the packages and
clients and runs the existing unit, integration, and browser tests on Linux.

Dependabot checks npm daily and GitHub Actions weekly. Routine versions wait seven
days before update PRs; security update PRs bypass the cooldown. Major versions
remain separate from grouped routine patch/minor updates. Workflow actions are
pinned to commit hashes and kept current by Dependabot.

Enable Dependabot alerts and security updates in the repository's security
settings as well; a configuration file alone does not enable those settings.
Require the dependency-security check and build/tests before merging an update.

For dependency updates, start with install scripts disabled, inspect the changed
packages, then run only the setup scripts needed by the build:

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 esbuild @prisma/engines prisma
npm run security:audit
npm run build
npm run test
```

On a new host, separately install the Playwright browser when required. A package
audit covers published advisories; it does not establish that every package is
trustworthy. Review unexpected new dependencies and install scripts even when the
audit passes. Avoid running dependency installation as root or with unnecessary
production credentials available.

## Molten runtime

The current runtime channel is Node 22 LTS from NodeSource. The October 21, 2026
security release is 22.23.4. Stay on supported, patched LTS releases and test major
runtime upgrades before deploying them.

Use `/usr/bin/node` for both the PM2 daemon's systemd service and the NAISYS app
interpreter. Remove version-specific NVM paths from the boot configuration so a
future OS package update remains the runtime used after restart.

Ubuntu's standard unattended-upgrades origins do not include NodeSource. Check
the NodeSource package candidate separately or deliberately configure its origin
for automatic patch updates. Either approach needs a controlled PM2 restart and
verification of the actual running executable after an update. Installing a new
Node package alone does not patch an existing process.

Build a replacement deployment while the current server is running. Preserve its
PM2 launch configuration and SQLite backups, switch only the integrated NAISYS
server, and verify Supervisor, ERP, APIs, assets, and live updates over HTTPS. Keep
the previous deployment available for rollback. Do not automatically run
`npm audit fix --force` against the live installation.

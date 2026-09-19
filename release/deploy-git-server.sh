#!/usr/bin/env bash
# One-time conversion of the existing /home/naisys npm/PM2 server to Git.
# Run as the existing naisys account. Keeps data, environment and old npm install.
set -euo pipefail
umask 077

commit=${1:?Usage: deploy-git-server.sh FULL_COMMIT_HASH}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "A full commit hash is required." >&2; exit 1; }
[[ $(id -un) == naisys && "$HOME" == /home/naisys ]] || { echo "Run with sudo -iu naisys." >&2; exit 1; }
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
export PM2_HOME="$HOME/.pm2"
for command in git node npm pm2 python3 curl; do command -v "$command" >/dev/null; done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'

repo="$HOME/naisys-git"
backup="$HOME/deployment-backups/$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:8}"
mkdir -p "$backup"
pm2 jlist > "$backup/pm2-before.json"

# Save only the selected server's launch configuration, with private permissions.
node - "$backup" "$repo" <<'JS'
const fs = require('fs');
const path = require('path');
const [backup, repo] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync(path.join(backup, 'pm2-before.json')));
const servers = all.filter(p => {
  const args = p.pm2_env.args;
  return Array.isArray(args) && ['--integrated-hub', '--supervisor', '--erp'].every(a => args.includes(a));
});
if (servers.length !== 1) throw new Error('Expected exactly one integrated NAISYS server; nothing changed.');
const p = servers[0], e = p.pm2_env;
if (e.pm_cwd !== '/home/naisys' || e.exec_mode !== 'fork_mode') throw new Error('Unexpected server cwd/mode; inspect before conversion.');
if (!e.pm_exec_path.startsWith('/home/naisys/.nvm/') && !e.pm_exec_path.startsWith('/usr/')) throw new Error('Expected the existing npm/npx launch; inspect before conversion.');
const old = {
  name: p.name, script: e.pm_exec_path, args: e.args, cwd: e.pm_cwd,
  interpreter: e.exec_interpreter, env: e.env || {}, instances: 1,
  autorestart: e.autorestart !== false, watch: false,
  out_file: e.pm_out_log_path, error_file: e.pm_err_log_path,
  kill_timeout: e.kill_timeout || 30000,
};
const next = {
  ...old, script: path.join(repo, 'apps/naisys/bin/naisys.js'),
  interpreter: process.execPath, args: ['--integrated-hub', '--supervisor', '--erp'],
  env: { ...old.env, NAISYS_FOLDER: '/var/naisys' },
};
for (const [name, value] of [['npm-server.json', old], ['git-server.json', next]]) {
  fs.writeFileSync(path.join(backup, name), JSON.stringify({apps: [value]}, null, 2), {mode: 0o600});
}
fs.writeFileSync(path.join(backup, 'server-name'), p.name);
JS
name=$(cat "$backup/server-name")

if [[ ! -e "$repo" ]]; then
  git clone https://github.com/swax/NAISYS.git "$repo"
else
  [[ -d "$repo/.git" ]] || { echo "$repo exists but is not a checkout." >&2; exit 1; }
  [[ -z $(git -C "$repo" status --porcelain) ]] || { echo "Git checkout is dirty; nothing changed." >&2; exit 1; }
  [[ $(git -C "$repo" remote get-url origin) == https://github.com/swax/NAISYS.git ]] || { echo "Unexpected repository remote." >&2; exit 1; }
fi
git -C "$repo" fetch origin main
git -C "$repo" merge-base --is-ancestor "$commit" origin/main
git -C "$repo" checkout --detach "$commit"
cd "$repo"
[[ $(node -p 'require("./package.json").name') == naisys-monorepo ]]
NODE_ENV='' npm ci
NODE_ENV='' npm run build -- --concurrency=2
[[ -f apps/naisys/dist/naisys.js && -f apps/erp/server/dist/erpServer.js ]]
# This conversion's rollback is compatible specifically with the additive 46→47 change.
node --input-type=module -e 'const {ERP_DB_VERSION}=await import("./apps/erp/server/dist/database/dbConfig.js"); if(ERP_DB_VERSION!==47) throw Error("Review deployment script for this schema version")'

python3 - <<'PY'
import sqlite3
with sqlite3.connect('file:/var/naisys/database/naisys_erp.db?mode=ro', uri=True) as db:
    version = db.execute('SELECT version FROM schema_version WHERE id=1').fetchone()[0]
    if version != 46:
        raise SystemExit(f'Expected the existing npm ERP schema 46, got {version}; service unchanged.')
PY

rollback() {
  trap - ERR INT TERM
  echo "Git deployment did not pass verification; restoring the npm launch." >&2
  pm2 delete "$name" >/dev/null 2>&1 || true
  # Preserve new data and the additive column; only restore the old startup marker.
  python3 - <<'PY'
import sqlite3
with sqlite3.connect('/var/naisys/database/naisys_erp.db') as db:
    db.execute('UPDATE schema_version SET version=46 WHERE id=1 AND version=47')
PY
  pm2 start "$backup/npm-server.json" --only "$name"
  pm2 save
  echo "Backup and launch configurations: $backup" >&2
  exit 1
}
trap rollback ERR INT TERM
pm2 stop "$name"
python3 - "$backup" <<'PY'
import pathlib, sqlite3, sys
backup = pathlib.Path(sys.argv[1]) / 'database'
backup.mkdir()
for source in pathlib.Path('/var/naisys/database').glob('*.db'):
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as src, sqlite3.connect(backup / source.name) as dst:
        src.backup(dst)
print('SQLite backups complete.')
PY
pm2 delete "$name"
pm2 start "$backup/git-server.json" --only "$name"

ready=0
for attempt in $(seq 1 60); do
  if pm2 jlist | node -e '
    let s=""; process.stdin.on("data", d=>s+=d).on("end",()=>{
      const ps=JSON.parse(s), repo=process.argv[1];
      process.exit(ps.some(p=>p.pm2_env.pm_exec_path===repo+"/apps/naisys/bin/naisys.js" && p.pm2_env.status==="online" && Date.now()-p.pm2_env.pm_uptime>15000)?0:1);
    });' "$repo" && curl --fail --silent --output /dev/null --max-time 10 https://test.naisys.org/erp/; then
    if python3 - <<'PY'
import sqlite3
with sqlite3.connect('file:/var/naisys/database/naisys_erp.db?mode=ro', uri=True) as db:
    assert db.execute('SELECT version FROM schema_version WHERE id=1').fetchone()[0] == 47
    assert 'retry_not_before' in {row[1] for row in db.execute('PRAGMA table_info(operation_runs)')}
    assert db.execute("SELECT finished_at FROM _prisma_migrations WHERE migration_name='20260919062000_operation_retry_not_before'").fetchone()[0]
PY
    then ready=1; break; fi
  fi
  sleep 3
done
[[ "$ready" == 1 ]] || rollback
pm2 save
trap - ERR INT TERM
printf 'Deployed Git commit %s; ERP schema 47 verified.\nBackup: %s\n' "$commit" "$backup"
echo 'The old npm installation and data remain available. Other hosts were not changed.'

# Hub Security: Per-Host Access Keys

## Goal

Each NAISYS instance authenticates to the hub with a key that identifies a specific host row in the DB. There is no global shared secret; rotating one host's key only affects that host. TLS is delegated to a reverse proxy.

## Design

### Division of responsibility

- **Transport encryption** → reverse proxy (nginx, Caddy, Cloudflare, ngrok, etc.). The hub listens on plain HTTP bound to `0.0.0.0`; the proxy terminates TLS in front of it.
- **Client identity + authentication** → per-host access key, hashed in the `hosts` table and checked in the Socket.IO auth middleware.
- **Per-user authorization** (attachment upload/download, REST endpoints) → per-user API keys sent as `Authorization: Bearer <key>`. Two flavors — external (supervisor/ERP, user-managed) and internal (hub runtime keys, hub-minted) — both stored hashed. See [Per-user API keys](#per-user-api-keys).

This keeps the hub implementation simple and lets operators use whatever TLS setup they already trust (Let's Encrypt via Caddy, a managed tunnel, an internal CA, etc.).

### Access key format

A single random secret per host: 32 bytes of `crypto.randomBytes` hex-encoded to 64 characters. No structure, no prefix, no embedded identifier.

Storage:

- **DB**: `hosts.access_key_hash` holds `sha256(plaintext)` (hex). The column is `@unique` so auth is a single indexed lookup.
- **Plaintext**: never persisted by the hub. Shown once in the supervisor UI at create/rotate time. The operator copies it into the NAISYS client's `HOST_ACCESS_KEY` env var.

A plain SHA-256 (not bcrypt/scrypt) is fine because the input is already 256 bits of entropy — there's no password to brute-force, so a slow KDF would buy nothing.

### How keys reach clients

There are three host shapes, each with its own provisioning path.

**1. Remote NAISYS client** (`naisys --hub=https://…`)

The standard case. The operator:

1. Opens the supervisor → Hosts → **Add Host**, enters a name, clicks Create.
2. Copies the plaintext key shown in the one-time modal (or copies the `HOST_ACCESS_KEY=…` snippet directly).
3. Pastes it into the NAISYS machine's `.env`.
4. Starts NAISYS — the client sends the key in the handshake, the hub hashes it, matches `hosts.access_key_hash`, attaches the socket to that host.

If a host needs a new key (suspected leak, machine handoff), the supervisor's host detail page exposes a **Rotate** action that generates a fresh key, replaces the hash, and shows the new plaintext once. The previous key stops authenticating immediately.

**2. Integrated NAISYS** (`naisys --integrated-hub`)

The hub and a NAISYS client share a process, so the client needs a key but the operator usually doesn't want to babysit one. `bootstrapIntegratedNaisysHost` runs inside `startHub` (only when `startupType === "hosted"`) and:

1. Resolves the hostname (`NAISYS_HOSTNAME` env, falling back to `os.hostname()`).
2. Resolves the plaintext key in order: `process.env.HOST_ACCESS_KEY` → `NAISYS_FOLDER/cert/integrated-naisys-access-key` → freshly generated and cached to that file (mode `0o600`).
3. Sets `process.env.HOST_ACCESS_KEY` so the in-process hub-client picks it up via `resolveHostAccessKey()`.
4. Ensures a `hosts` row exists for that hostname with `access_key_hash = sha256(plaintext)` (creates if missing, reconciles if drifted).

Net effect: first run silently generates and caches a key; later runs reuse it; setting the env var explicitly always wins.

**3. Supervisor's own hub-client**

The supervisor is also a hub-client (it subscribes to log/mail/cost push events). Its bootstrap mirrors the integrated path but is cleaner — there's no env var because the supervisor isn't user-configurable as a host. `bootstrapSupervisorHost` runs inside `bootstrapSupervisor`:

1. Cached plaintext lives at `NAISYS_FOLDER/cert/integrated-supervisor-access-key`.
2. If the file exists and its hash matches `hosts.access_key_hash` for the `SUPERVISOR` host, short-circuit.
3. Otherwise generate a fresh key, write the file, upsert the `SUPERVISOR` row with `host_type = supervisor` and the new hash.

The hash check on the short-circuit means a DB restore that doesn't restore the cert file (or vice versa) regenerates rather than failing handshake silently.

### Authentication middleware

`apps/hub/src/server/naisysServer.ts` handles every incoming socket:

1. Pull `accessKey`, `instanceId`, `startedAt`, `clientVersion`, `environment` off `socket.handshake.auth`.
2. Reject with `invalid_access_key` (non-fatal) if `accessKey` is missing.
3. Call `hostRegistrar.resolveByAccessKey(accessKey)` — hashes the plaintext, looks up by `access_key_hash`. Returns `null` if no row matches; reject with `invalid_access_key`.
4. Call `hostRegistrar.markActive(resolved, ip, version, environment)` — stamps `last_active`, `last_ip`, `last_version`, `environment` on the row and upserts the in-memory cache so the host shows up in the next `HOSTS_UPDATED` broadcast even if it was added after registrar startup.
5. For `naisys` hostType: supersede any existing connection for this `hostId` from an older process (the newer `processStartedAt` wins). Older processes attempting to reclaim a host are rejected with `superseded_by_newer_instance`. Supervisors are exempt — multiple supervisor browsers can coexist on the same `SUPERVISOR` host.
6. Attach `hostId`, `hostName`, `instanceId`, `processStartedAt`, `hostType`, `clientVersion` to `socket.data` for downstream services.

The handshake no longer carries `hostName`, `machineId`, or `hostType` — the DB row resolved from the access key is authoritative for all three.

After a successful connection, the hub pushes a slim `HOST_REGISTERED` event (`{ hostId, hostName }`) back to the client so it knows which row in `HOSTS_UPDATED` is itself.

### Access key rotation

Rotation is per-host, not global. The flow:

1. Operator opens the supervisor → Hosts → selected host, clicks **Rotate**.
2. Supervisor `POST /hosts/:hostname/rotate-access-key` calls `rotateHostAccessKey(hostname)` → generates a fresh 32-byte key, replaces `hosts.access_key_hash`, returns plaintext.
3. The route also sends `HOST_REKEYED` to the hub. The hub handler force-disconnects any live socket bound to that `hostId` so the client is pushed off the stale key immediately; its next reauth fails with `invalid_access_key`, prompting the operator to update `HOST_ACCESS_KEY` on the remote machine.
4. The plaintext is shown in a one-time modal (with `HOST_ACCESS_KEY=…` snippet + copy button). It is not persisted server-side and is never shown again.

The `SUPERVISOR` host can't be rotated through this route — its bootstrap is self-managed; rotating from the UI would just race the bootstrap on next restart.

## Per-user API keys

Distinct from the host access key, individual users hold their own API keys for REST endpoints (attachment upload/download, supervisor and ERP HTTP routes). All are 32 random bytes hex-encoded and stored as SHA-256 hashes — `hashToken()` is the same helper across the codebase. Plaintext is never re-derivable from the DB. Two flavors:

### External keys (supervisor / ERP user-facing)

Issued from the supervisor Users page and the ERP equivalent. The plaintext is shown to the human user once at issue time, then only the hash persists (`apiKeyHash` column on the supervisor and ERP `users` tables, e.g. `apps/erp/server/prisma/schema.prisma:422`). Auth middleware hashes the incoming bearer token and looks it up — see `apps/erp/server/src/auth-middleware.ts:79`. Lost keys can't be recovered, only re-issued.

### Internal keys (hub runtime keys for runners / agents)

NAISYS runners and the agents they host need to call hub REST endpoints (e.g. attachment upload). They authenticate with a per-agent `NAISYS_API_KEY` minted by the hub, never displayed to a user. Stored as `api_key_hash` on the hub `users` table (`packages/hub-database/prisma/schema.prisma`).

`hubRuntimeKeyService.ts` is the issuer: `issueRuntimeApiKey(userId)` generates 32 random bytes, writes the hash to `users.api_key_hash`, and registers the plaintext with the redaction service so log lines that happen to include the key get scrubbed before DB write. `revokeRuntimeApiKey(userId)` clears the hash and the redactor's per-user plaintext set.

### Re-issue on hub restart

Because internal keys are runtime-only, the hub holds the plaintext only in memory. After a hub restart it has the hash but not the plaintext, so it can no longer recognize the key in incoming logs to redact it. The fix: re-issue.

The heartbeat carries a `runtimeApiKeys` array — one `{ userId, runtimeApiKey? }` claim per top-level agent the runner is hosting. On each heartbeat the hub:

1. Re-registers each claimed plaintext with the redactor (idempotent; old plaintexts accumulate per user as a `Set` so leaks during a rotation transition window still scrub — the set is cleared on `AGENT_STOP`).
2. Compares `hashToken(claim.runtimeApiKey)` against `users.api_key_hash`. If it matches, nothing to do.
3. Otherwise mints a fresh key via `issueRuntimeApiKey` and pushes it back over `HubEvents.RUNTIME_KEY_REISSUE`. The runner adopts the new key and includes it in subsequent heartbeats.

Net effect: across any hub restart the agent ends up with a key whose plaintext the hub knows, so redaction stays effective. Disconnect alone doesn't trigger re-issue — the DB hash stays valid and the next heartbeat re-registers the plaintext.

## Redaction service

`hubRedactionService.ts` strips known secrets from text before it hits the DB or gets rebroadcast. It sits in front of any persisted free-form input from clients:

- `hubLogService.ts` — `redactionService.redact(entry.message)` on every log line.
- `hubSendMailService.ts` — `redact(params.subject)` and `redact(params.body)` on every outgoing mail.

Sources of secrets to scrub:

1. **DB variables flagged sensitive** — rows from the hub `variables` table where `sensitive = true`, loaded once at service startup (`rebuildDbSecrets`) and rebuilt on every `HubEvents.VARIABLES_CHANGED`. Replacement form is `[REDACTED:<key>]` so the variable name leaks but the value doesn't. Sorted longest-first so a value that's a prefix of another doesn't get partially replaced.
2. **Runtime NAISYS API keys** — plaintext registered by `issueRuntimeApiKey` and by heartbeat re-registration, accumulated per `userId` as a `Set` so old plaintexts within an agent's transition window still match. Replacement form `[REDACTED:NAISYS_API_KEY:<userId>]`.
3. **Pattern fallbacks** — generic shapes that catch unregistered tokens: `Authorization: Bearer/Basic …`, PEM private key blocks, JWTs, AWS access key IDs (`AKIA…`).

Values shorter than 6 characters are skipped to avoid pathological substitution. The redactor only runs on the hub side — clients trust nothing-redacted local logs.

Host access keys are not registered with the redactor because the hub never receives them as text in normal operation (they're only in `socket.handshake.auth` on the connecting socket, never in messages).

### Why no fingerprint-pinning scheme?

The original design bundled a TLS certificate fingerprint prefix into the access key so clients could verify the server out-of-band. That was removed once TLS moved to the reverse proxy:

- The proxy typically holds a real CA-signed certificate (Let's Encrypt, internal CA), which clients validate through the normal browser/Node trust chain.
- Even when the proxy uses self-signed certs, operators already have their own process for distributing trust roots.
- Keeping the hub itself plain-HTTP simplifies testing, makes `ngrok` and managed tunnels work out of the box, and removes the need for cert rotation in the hub.

Clients never do TLS pinning. The per-host access key alone authenticates them to the hub; the TLS layer (if any) is the operator's responsibility.

## Setup flows

### Integrated mode (single machine)

`naisys --integrated-hub` just works. The bootstrap creates the SUPERVISOR host (if `--supervisor`) and the local naisys host on first run, caching plaintext keys under `NAISYS_FOLDER/cert/`. No env-var setup needed; no copying secrets.

### Standalone mode (multi-machine)

1. On the hub machine, open the supervisor → Hosts → **Add Host**, name it (e.g. `worker-gpu-01`), click Create.
2. Copy the plaintext key from the one-time modal.
3. On the worker machine, set the client `.env`:
   ```
   HOST_ACCESS_KEY=<key from step 2>
   ```
4. Run `naisys --hub=https://hub.example.com/hub` (where the reverse proxy sits in front of the hub's plain-HTTP port).
5. The client connects, the proxy terminates TLS, Socket.IO authenticates via the per-host access key.

`NAISYS_HOSTNAME` on the remote client is irrelevant — the hub already knows the host's name from the row the key resolves to.

Repeat steps 1–4 for each additional remote host. Each gets its own key; nothing is shared.

### Reverse proxy notes

- The hub serves Socket.IO on `/hub/socket.io` and attachment routes on `/hub/attachments`. Route everything under `/hub` through to the hub's `SERVER_PORT` (default 3300).
- Socket.IO needs WebSocket upgrade support (`Connection: upgrade`, `Upgrade: websocket`).
- For ngrok, clients send the `ngrok-skip-browser-warning: true` header automatically (`hubConnection.ts`).

## Security considerations

- **File permissions** — Bootstrap cert files (`integrated-naisys-access-key`, `integrated-supervisor-access-key`) are written with mode `0o600` (owner read/write only).
- **Access key required** — Clients without an access key fail fast (`hubClientConfig.ts` throws; `hubConnection.ts` reports `HOST_ACCESS_KEY is not set`) rather than attempting an unauthenticated connection.
- **No auto-registration** — Unknown access keys are rejected. A host must exist in the supervisor (or be bootstrapped by an integrated process) before its key works. This eliminates the old "first-connect creates a host" footgun.
- **Transport encryption** — Provided externally by the reverse proxy. The hub does not serve HTTPS itself, so deploying the hub directly on the public internet without a proxy exposes the access key in cleartext. The documented setup assumes a proxy is in front of any non-loopback deployment.
- **Rotation kicks the affected host** — Rotating a host's key sends `HOST_REKEYED` to the hub, which drops the live socket for that host. The next reauth attempt fails with `invalid_access_key` and the operator updates `HOST_ACCESS_KEY` on the remote machine. Other hosts are unaffected.
- **Persistence** — Bootstrap keys for integrated/supervisor survive restarts. Deleting their cert files forces regeneration on next startup (and the bootstrap reconciles the matching `hosts` row to the new hash).
- **Per-user keys are separate** — Attachment upload/download and REST endpoints use per-user API keys (`Authorization: Bearer`), not host access keys. External keys are managed on the supervisor Users page; internal runtime keys are minted by the hub per agent and never surface in the UI. See [Per-user API keys](#per-user-api-keys).
- **Excluded from client config distribution** — `HOST_ACCESS_KEY` (and the legacy `HUB_ACCESS_KEY` name, for upgraded installs) are in `globalConfigLoader.EXCLUDED_KEYS` so the hub never distributes them via the config channel.

## Environment variables

| Variable          | Where                     | Purpose                                                                  |
| ----------------- | ------------------------- | ------------------------------------------------------------------------ |
| `NAISYS_FOLDER`   | Hub, NAISYS, Supervisor   | Base directory for cert files and databases (`NAISYS_FOLDER/cert/`)      |
| `HOST_ACCESS_KEY` | NAISYS client             | The host's access key — required for remote (standalone) hub connections |
| `NAISYS_HOSTNAME` | NAISYS (integrated only)  | Optional override for the host's name on first integrated bootstrap      |
| `SERVER_PORT`    | Hub                       | Plain-HTTP port the hub listens on (default 3300); the proxy points here |

`HOST_ACCESS_KEY` is listed in `globalConfigLoader.EXCLUDED_KEYS` (alongside the legacy `HUB_ACCESS_KEY` name) so the hub never distributes it to clients through the config channel.

## Files

| File                                                                       | Role                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/hub/src/server/naisysServer.ts`                                      | Socket.IO auth middleware that resolves host by access-key hash            |
| `apps/hub/src/lifecycle/hostRegistrar.ts`                                  | `resolveByAccessKey` + `markActive` + cache                                |
| `apps/hub/src/lifecycle/integratedHostBootstrap.ts`                        | Generates/reconciles the integrated naisys host + key                      |
| `apps/hub/src/lifecycle/hubHostService.ts`                                 | Broadcasts host list; handles `HOST_REKEYED` (force-disconnect)            |
| `apps/supervisor/server/src/services/comms/supervisorHostBootstrap.ts`     | Generates/reconciles the SUPERVISOR host + key                             |
| `apps/supervisor/server/src/services/hostService.ts`                       | `createHost` + `rotateHostAccessKey` (DB-side key generation)              |
| `apps/supervisor/server/src/routes/infra/hosts.ts`                         | `POST /hosts` (with plaintext in response) + rotate route                  |
| `apps/supervisor/server/src/services/comms/hubConnectionService.ts`        | Supervisor's hub-client — reads cert key, sends `HOST_REKEYED`             |
| `packages/common-node/src/hub/hostAccessKey.ts`                            | Shared `resolveHostAccessKey()` (env-var only)                             |
| `apps/naisys/src/hub/hubClientConfig.ts`                                   | Client-side check that `HOST_ACCESS_KEY` is configured                     |
| `apps/naisys/src/hub/hubConnection.ts`                                     | NAISYS Socket.IO client — sends the key in `auth`                          |
| `NAISYS_FOLDER/cert/integrated-naisys-access-key`                          | Plaintext key for the integrated naisys host (mode 0o600)                  |
| `NAISYS_FOLDER/cert/integrated-supervisor-access-key`                      | Plaintext key for the SUPERVISOR host (mode 0o600)                         |

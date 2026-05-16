# Hub Security: Access Key Authentication

## Goal

Make self-hosted hubs secure with zero manual secret setup. An auto-generated access key authenticates clients; TLS is delegated to a reverse proxy.

## Problem

The hub originally used plain HTTP with a manually configured `HUB_ACCESS_KEY` shared secret. Two issues:

1. **No encryption** — traffic between hub and clients (NAISYS instances, Supervisor) was cleartext, including auth tokens and agent data.
2. **Manual key management** — the admin had to invent a secret and copy it to every machine's `.env`.

## Design

### Division of responsibility

- **Transport encryption** → reverse proxy (nginx, Caddy, Cloudflare, ngrok, etc.). The hub listens on plain HTTP bound to `0.0.0.0`; the proxy terminates TLS in front of it.
- **Client authentication** → hub access key, checked in the Socket.IO auth middleware.
- **Per-user authorization** (attachment upload/download, REST endpoints) → per-user API keys sent as `Authorization: Bearer <key>`. Two flavors — external (supervisor/ERP, user-managed) and internal (hub runtime keys, hub-minted) — both stored hashed. See [Per-user API keys](#per-user-api-keys).

This keeps the hub implementation simple and lets operators use whatever TLS setup they already trust (Let's Encrypt via Caddy, a managed tunnel, an internal CA, etc.) instead of a self-signed fingerprint-pinning scheme.

### Access key format

A single random secret: 32 bytes of `crypto.randomBytes` hex-encoded to 64 characters. No structure, no prefix, no embedded identifier.

Stored at `NAISYS_FOLDER/cert/hub-access-key` with mode `0o600`. On first startup the hub generates it; on subsequent startups it reads the existing file.

The path still uses `cert/` for historical reasons (it previously held TLS material too).

### Access key resolution on clients

Clients resolve the access key via `resolveHubAccessKey()` in `@naisys/common-node`:

1. `process.env.HUB_ACCESS_KEY` if set (standalone/multi-machine mode)
2. Otherwise fall back to reading `NAISYS_FOLDER/cert/hub-access-key` (integrated mode, where the hub and client share a data folder)

The key is re-read on every connection attempt so that a rotated key is picked up on the next reconnect without restarting the client.

### Authentication middleware

The hub's Socket.IO middleware (`apps/hub/src/services/naisysServer.ts`) validates `socket.handshake.auth.hubAccessKey` against the hub's current access key. Mismatch → connection rejected with error code `invalid_access_key`. Missing `hostName` → `missing_host_name`. Registration failure → `registration_failed`.

The middleware also records `hostType` (`naisys` or `supervisor`), `machineId`, `instanceId`, `processStartedAt`, and `clientVersion` on `socket.data` for downstream services. If a newer process for the same host reconnects, the older connection is superseded; an older process trying to reclaim a host is rejected with `superseded_by_newer_instance`.

### Access key rotation

The supervisor admin page exposes a rotate action. The flow:

1. Supervisor emits `rotate_access_key` to the hub over its existing socket.
2. `hubAccessKeyService.ts` calls `rotateAccessKey()`, which writes a new random 32-byte hex key to `hub-access-key` (still mode `0o600`).
3. The hub's auth middleware is updated in-memory via `naisysServer.updateHubAccessKey(newKey)` so new connections use the new key immediately.
4. The ack response returns the new key to the requesting supervisor so the admin can copy it.
5. The hub then calls `disconnectAllClients()`. All NAISYS instances and supervisors drop. Each will reconnect, but only clients that have been given the new key will succeed.

The rotated key is shown in the supervisor UI's admin page only — it is not pushed to other clients. Remote NAISYS instances must be re-configured with the new `HUB_ACCESS_KEY`.

## Per-user API keys

Distinct from the hub access key, individual users hold their own API keys for REST endpoints (attachment upload/download, supervisor and ERP HTTP routes). All are 32 random bytes hex-encoded and stored as SHA-256 hashes — `hashToken()` is the same helper across the codebase. Plaintext is never re-derivable from the DB. Two flavors:

### External keys (supervisor / ERP user-facing)

Issued from the supervisor Users page and the ERP equivalent. The plaintext is shown to the human user once at issue time, then only the hash persists (`apiKeyHash` column on the supervisor and ERP `users` tables, e.g. `apps/erp/server/prisma/schema.prisma:422`). Auth middleware hashes the incoming bearer token and looks it up — see `apps/erp/server/src/auth-middleware.ts:79`. Lost keys can't be recovered, only re-issued.

### Internal keys (hub runtime keys for runners / agents)

NAISYS runners and the agents they host need to call hub REST endpoints (e.g. attachment upload). They authenticate with a per-agent `NAISYS_API_KEY` minted by the hub, never displayed to a user. Stored as `api_key_hash` on the hub `users` table (`packages/hub-database/prisma/schema.prisma:185`).

`hubRuntimeKeyService.ts` is the issuer: `issueRuntimeApiKey(userId)` generates 32 random bytes, writes the hash to `users.api_key_hash`, and registers the plaintext with the redaction service so log lines that happen to include the key get scrubbed before DB write. `revokeRuntimeApiKey(userId)` clears the hash and the redactor's per-user plaintext set.

### Re-issue on hub restart

Because internal keys are runtime-only, the hub holds the plaintext only in memory. After a hub restart it has the hash but not the plaintext, so it can no longer recognize the key in incoming logs to redact it. The fix: re-issue.

The heartbeat carries a `runtimeApiKeys` array (`packages/hub-protocol/src/schemas/heartbeat.ts:36`) — one `{ userId, runtimeApiKey? }` claim per top-level agent the runner is hosting. On each heartbeat (`apps/hub/src/handlers/hubHeartbeatService.ts:128`) the hub:

1. Re-registers each claimed plaintext with the redactor (idempotent; old plaintexts accumulate per user as a `Set` so leaks during a rotation transition window still scrub — the set is cleared on `AGENT_STOP`).
2. Compares `hashToken(claim.runtimeApiKey)` against `users.api_key_hash`. If it matches, nothing to do.
3. Otherwise mints a fresh key via `issueRuntimeApiKey` and pushes it back over `HubEvents.RUNTIME_KEY_REISSUE`. The runner adopts the new key and includes it in subsequent heartbeats.

Net effect: across any hub restart the agent ends up with a key whose plaintext the hub knows, so redaction stays effective. Disconnect alone doesn't trigger re-issue — the DB hash stays valid and the next heartbeat re-registers the plaintext.

## Redaction service

`hubRedactionService.ts` strips known secrets from text before it hits the DB or gets rebroadcast. It sits in front of any persisted free-form input from clients:

- `hubLogService.ts:35` — `redactionService.redact(entry.message)` on every log line.
- `hubSendMailService.ts:33` — `redact(params.subject)` and `redact(params.body)` on every outgoing mail.

Sources of secrets to scrub:

1. **DB variables flagged sensitive** — rows from the hub `variables` table where `sensitive = true`, loaded once at service startup (`rebuildDbSecrets`) and rebuilt on every `HubEvents.VARIABLES_CHANGED`. Replacement form is `[REDACTED:<key>]` so the variable name leaks but the value doesn't. Sorted longest-first so a value that's a prefix of another doesn't get partially replaced.
2. **Runtime NAISYS API keys** — plaintext registered by `issueRuntimeApiKey` and by heartbeat re-registration, accumulated per `userId` as a `Set` so old plaintexts within an agent's transition window still match. Replacement form `[REDACTED:NAISYS_API_KEY:<userId>]`.
3. **Pattern fallbacks** — generic shapes that catch unregistered tokens: `Authorization: Bearer/Basic ...`, PEM private key blocks, JWTs, AWS access key IDs (`AKIA...`).

Values shorter than 6 characters are skipped to avoid pathological substitution. The redactor only runs on the hub side — clients trust nothing-redacted local logs.

### Why no fingerprint-pinning scheme?

The original design bundled a TLS certificate fingerprint prefix into the access key so clients could verify the server out-of-band. That was removed once TLS moved to the reverse proxy:

- The proxy typically holds a real CA-signed certificate (Let's Encrypt, internal CA), which clients validate through the normal browser/Node trust chain.
- Even when the proxy uses self-signed certs, operators already have their own process for distributing trust roots.
- Keeping the hub itself plain-HTTP simplifies testing, makes `ngrok` and managed tunnels work out of the box, and removes the need for cert rotation in the hub.

Clients never do TLS pinning. The access key alone authenticates them to the hub; the TLS layer (if any) is the operator's responsibility.

## Setup flows

### Integrated mode (single machine)

`naisys --integrated-hub` runs the hub in the same process as the NAISYS runner. Both read the access key from the shared `NAISYS_FOLDER/cert/hub-access-key` file, so no configuration is needed — it just works.

### Standalone mode (multi-machine)

1. Start the hub on machine A. It logs the access key path: `[Hub] Hub access key located at: <NAISYS_FOLDER>/cert/hub-access-key`. Read the file to get the key — or copy it from the supervisor admin page.
2. On machine B, set the client `.env`:
   ```
   HUB_ACCESS_KEY=<the access key from step 1>
   ```
3. Run naisys with `--hub=https://hub.example.com/hub` (where the reverse proxy sits in front of machine A's plain-HTTP hub port).
4. The client connects, the proxy terminates TLS, Socket.IO authenticates via the access key.

The access key only needs to be copied once per client machine. If it's rotated, every client needs the new key.

### Reverse proxy notes

- The hub serves Socket.IO on `/hub/socket.io` and attachment routes on `/hub/attachments`. Route everything under `/hub` through to the hub's `SERVER_PORT` (default 3300).
- Socket.IO needs WebSocket upgrade support (`Connection: upgrade`, `Upgrade: websocket`).
- For ngrok, clients send the `ngrok-skip-browser-warning: true` header automatically (`hubConnection.ts:54`).

## Security considerations

- **File permissions** — `hub-access-key` is written with mode `0o600` (owner read/write only).
- **Access key required** — Clients without an access key fail fast (`hubClientConfig.ts:11` throws; `hubConnection.ts:46` reports `No hub access key available`) rather than attempting an unauthenticated connection.
- **Transport encryption** — Provided externally by the reverse proxy. The hub does not serve HTTPS itself, so deploying the hub directly on the public internet without a proxy exposes the access key in cleartext. The documented setup assumes a proxy is in front of any non-loopback deployment.
- **Rotation disconnects everyone** — Rotation is deliberately disruptive: all clients are kicked so there's no grace period where the old key still works. The new key is returned only to the requesting supervisor.
- **Persistence** — The access key survives restarts. Deleting `cert/hub-access-key` forces regeneration on next startup.
- **Per-user keys are separate** — Attachment upload/download and REST endpoints use per-user API keys (`Authorization: Bearer`), not the hub access key. External keys are managed on the supervisor Users page; internal runtime keys are minted by the hub per agent and never surface in the UI. See [Per-user API keys](#per-user-api-keys).

## Environment variables

| Variable         | Where                     | Purpose                                                                  |
| ---------------- | ------------------------- | ------------------------------------------------------------------------ |
| `NAISYS_FOLDER`  | Hub, NAISYS, Supervisor   | Base directory for the access key file (`NAISYS_FOLDER/cert/`)           |
| `HUB_ACCESS_KEY` | NAISYS client, Supervisor | The hub's access key — required for remote (standalone) hub connections  |
| `SERVER_PORT`    | Hub                       | Plain-HTTP port the hub listens on (default 3300); the proxy points here |

`HUB_ACCESS_KEY` is listed in `globalConfigLoader.EXCLUDED_KEYS` so the hub never distributes it to clients through the config channel.

## Files

| File                                                          | Role                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/hub/src/services/accessKeyService.ts`                   | Generates, loads, and rotates the hub access key on disk   |
| `apps/hub/src/handlers/hubAccessKeyService.ts`                | Handles `rotate_access_key` requests from the supervisor   |
| `apps/hub/src/handlers/hubRuntimeKeyService.ts`               | Mints / revokes per-agent runtime API keys (hashed)        |
| `apps/hub/src/handlers/hubRedactionService.ts`                | Scrubs sensitive variables and runtime keys from logs/mail |
| `apps/hub/src/services/naisysServer.ts`                       | Socket.IO auth middleware that validates the access key    |
| `packages/common-node/src/hubCertVerification.ts`             | Shared `resolveHubAccessKey()` / `readHubAccessKeyFile()`  |
| `apps/naisys/src/hub/hubClientConfig.ts`                      | Client-side check that an access key is configured         |
| `apps/naisys/src/hub/hubConnection.ts`                        | NAISYS Socket.IO client — sends the key in `auth`          |
| `apps/supervisor/server/src/services/hubConnectionService.ts` | Supervisor Socket.IO client — sends the key in `auth`      |
| `NAISYS_FOLDER/cert/hub-access-key`                           | The access key (mode 0o600)                                |

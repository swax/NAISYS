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
- **Per-user authorization** (attachment upload/download, REST endpoints) → separate user API keys sent as `Authorization: Bearer <key>`.

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
- **Per-user keys are separate** — Attachment upload/download and REST endpoints use per-user API keys (`Authorization: Bearer`), not the hub access key. Those are managed on the supervisor Users page.

## Environment variables

| Variable         | Where                     | Purpose                                                                  |
| ---------------- | ------------------------- | ------------------------------------------------------------------------ |
| `NAISYS_FOLDER`  | Hub, NAISYS, Supervisor   | Base directory for the access key file (`NAISYS_FOLDER/cert/`)           |
| `HUB_ACCESS_KEY` | NAISYS client, Supervisor | The hub's access key — required for remote (standalone) hub connections  |
| `SERVER_PORT`    | Hub                       | Plain-HTTP port the hub listens on (default 3300); the proxy points here |

`HUB_ACCESS_KEY` is listed in `globalConfigLoader.EXCLUDED_KEYS` so the hub never distributes it to clients through the config channel.

## Files

| File                                                          | Role                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `apps/hub/src/services/accessKeyService.ts`                   | Generates, loads, and rotates the hub access key on disk  |
| `apps/hub/src/handlers/hubAccessKeyService.ts`                | Handles `rotate_access_key` requests from the supervisor  |
| `apps/hub/src/services/naisysServer.ts`                       | Socket.IO auth middleware that validates the access key   |
| `packages/common-node/src/hubCertVerification.ts`             | Shared `resolveHubAccessKey()` / `readHubAccessKeyFile()` |
| `apps/naisys/src/hub/hubClientConfig.ts`                      | Client-side check that an access key is configured        |
| `apps/naisys/src/hub/hubConnection.ts`                        | NAISYS Socket.IO client — sends the key in `auth`         |
| `apps/supervisor/server/src/services/hubConnectionService.ts` | Supervisor Socket.IO client — sends the key in `auth`     |
| `NAISYS_FOLDER/cert/hub-access-key`                           | The access key (mode 0o600)                               |

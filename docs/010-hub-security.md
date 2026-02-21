# Hub TLS: Self-Signed Certificate + Access Key Authentication

## Goal

Make self-hosted hubs secure by default with zero manual TLS configuration. Auto-generated TLS provides encryption, and an auto-generated secret key provides authentication.

## Problem

Previously the hub used plain HTTP with a manually configured `HUB_ACCESS_KEY` shared secret. This had two issues:

1. **No encryption** — All traffic between hub and clients (NAISYS instances, Supervisor) was in cleartext, including auth tokens and agent data.
2. **Manual key management** — The admin had to invent a secret and copy it to every machine's `.env` file.

## Design

### Auto-generated self-signed TLS certificate

On first startup the hub checks for `NAISYS_FOLDER/cert/hub-key.pem` and `hub-cert.pem`. If missing, it generates a self-signed certificate (RSA 2048, SHA-256, 10-year validity) and writes both files to disk. On subsequent startups it loads the existing cert.

The hub runs HTTPS (not HTTP). All Socket.IO connections are encrypted.

### Hub access key format

The hub access key is a compound value: `<fingerprint_prefix>+<secret>`

- **Fingerprint prefix** (16 hex chars) — the first 16 characters of the SHA-256 fingerprint of the certificate's DER encoding. This identifies which hub the key belongs to.
- **Secret** (16 hex chars) — a randomly generated value stored in `NAISYS_FOLDER/cert/hub-access-key` (mode 0o600). This is the actual authentication token.

The combined value is printed at startup and must be presented by clients in their Socket.IO auth handshake.

### Why a separate secret?

The TLS certificate (and its fingerprint) is sent to any client during the TLS handshake — it's public information. Using the fingerprint alone as an access key would mean any host that can reach the port could authenticate. The random secret ensures that only clients who received the key out-of-band can connect.

### Why include the fingerprint prefix?

The fingerprint prefix serves as an identifier — if the admin is managing multiple hubs, the prefix helps match keys to the correct hub. It also changes if the cert is regenerated, making it obvious that all clients need a new key.

### Mutual verification

Both sides of the connection are verified:

- **Server verifies the client** — The hub's Socket.IO middleware checks that the client presents the correct full access key (fingerprint prefix + secret). This prevents unauthorized clients from connecting.
- **Client verifies the server** — Before establishing the Socket.IO connection, the client makes a TLS probe to the hub, retrieves the server's certificate, computes its SHA-256 fingerprint, and checks that it starts with the fingerprint prefix from the access key. This prevents MITM attacks — an attacker cannot produce a certificate whose fingerprint matches the expected prefix.

Clients connect with `rejectUnauthorized: false` since the cert is self-signed and won't pass standard CA validation. The fingerprint prefix check compensates for this, similar to SSH host key verification.

### Why not a traditional CA-signed cert?

Self-hosted hubs typically run on internal networks or home servers where:

- There's no domain name to get a Let's Encrypt cert for
- Buying a cert for an internal IP is unnecessary overhead
- The admin controls both ends (hub and clients)

## Setup flows

### Integrated mode (single machine)

When running `naisys --integrated-hub`, the hub starts in-process and the access key is passed in-memory. No configuration needed — it just works.

### Standalone mode (multi-machine)

1. Start the hub on machine A — it prints the access key to the console
2. On machine B, set the `.env` file:
   ```
   HUB_ACCESS_KEY=<the access key from step 1>
   ```
3. Run naisys with `--hub=https://machine-a:3101`
4. The client connects over TLS and authenticates with the access key

The access key only needs to be copied once per client machine. If the hub's cert directory is deleted and regenerated, all clients need the new access key.

## Security considerations

- **Secret key file permissions** — `hub-access-key` is written with mode `0o600` (owner read/write only).
- **Private key permissions** — `hub-key.pem` is also written with mode `0o600`.
- **No downgrade** — The hub only serves HTTPS. There is no HTTP fallback.
- **Cert persistence** — Certs and the access key survive restarts. Deleting the `cert/` directory forces regeneration.
- **MITM protection** — Clients verify the server's certificate fingerprint before connecting, preventing man-in-the-middle attacks even with `rejectUnauthorized: false`.
- **Access key required** — Clients that don't have a `HUB_ACCESS_KEY` configured will fail fast with an error rather than attempting an unauthenticated connection.

## Environment variables

| Variable         | Where                     | Purpose                                                                   |
| ---------------- | ------------------------- | ------------------------------------------------------------------------- |
| `NAISYS_FOLDER`  | Hub                       | Base directory for cert storage (`NAISYS_FOLDER/cert/`)                   |
| `HUB_ACCESS_KEY` | NAISYS client, Supervisor | The hub's access key, only needed for remote (standalone) hub connections |

## Files

| File                                                          | Role                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/common-node/src/hubCertVerification.ts`             | Shared: access key parsing, fingerprint computation, TLS cert verification |
| `apps/hub/src/services/certService.ts`                        | Generates/loads cert and access key                                        |
| `apps/naisys/src/hub/hubConnection.ts`                        | Client-side cert verification before socket.io connect                     |
| `apps/supervisor/server/src/services/hubConnectionService.ts` | Supervisor-side cert verification before socket.io connect                 |
| `NAISYS_FOLDER/cert/hub-key.pem`                              | TLS private key (mode 0o600)                                               |
| `NAISYS_FOLDER/cert/hub-cert.pem`                             | Self-signed TLS certificate                                                |
| `NAISYS_FOLDER/cert/hub-access-key`                           | Full composite access key (mode 0o600)                                     |

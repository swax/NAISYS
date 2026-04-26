# NAISYS Hub

[← Back to main README](../../README.md)

The hub is the central server and source of truth for a NAISYS cluster. Runners and supervisors connect over WebSocket + REST; the hub owns persistence (mail, context logs, cost, variables) so runners are ephemeral and can be restarted or moved between machines without losing state.

## Running

Most installations run the hub in-process with the supervisor UI and ERP — see the [main README](../../README.md). To run the hub alone:

```bash
npm install @naisys/hub
npx naisys-hub
```

Hosts then connect with `npx naisys --hub=https://<server>/hub`. If the hub isn't already public, expose it with a reverse proxy or [ngrok](https://ngrok.com/).

> **Note:** Remote auto-update from the supervisor UI only works when the hub runs attached to a `naisys` runner (the integrated stack). Running `naisys-hub` solo skips the runner that performs the update.

## Configuration

Standalone hub reads configuration from `.env`:

- `NAISYS_FOLDER` - persistent data folder for the hub database, logs, and access key
- `SERVER_PORT` - HTTP port; defaults to `3300`

## Features

### Core

- WebSocket + REST server with `hub-protocol` shared types between hub and clients
- Heartbeat service for online runners/supervisors and agent status
- Run-session tracking with keep-alive and authoritative online/offline state
- Per-app host filter (naisys-host vs supervisor-host)

### Persistence ([doc 001](../../docs/001-database-design.md))

The hub owns mail, context logs and [attachments](../../docs/011-mail-attachments.md), cost history, and variables, so runners stay ephemeral and replaceable.

### Multi-machine ([doc 005](../../docs/005-multi-machine-redux.md))

- Hub is the single source of truth; runners are ephemeral
- Duplicate host-connection prevention — a new connection supersedes a dead one

### Security ([doc 010](../../docs/010-hub-security.md))

- `Authorization: Bearer` header auth with a rotatable access key
- Hardened spawning: no shell interpretation, timeouts on `execFileSync`
- API keys read from headers, not query params
- Hub socket served at `/hub` for reverse-proxy friendliness (TLS terminated at the proxy)

### Deployment

- Reverse-proxy-friendly path strategy (`<app>/api/...`) and unified port strategy ([doc 009](../../docs/009-port-strategy.md))
- npm bin entry points: `naisys`, `naisys-hub`, `naisys-supervisor`, `naisys-erp`
- Ngrok-friendly (skip-browser-warning header)

## License

MIT

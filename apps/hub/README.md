# NAISYS Hub

[← Back to main README](../../README.md)

The hub is the central server and source of truth for a NAISYS cluster. Runners and supervisors connect over WebSocket + REST; the hub owns persistence (mail, context logs, cost, variables) so runners are ephemeral and can be restarted or moved between machines without losing state.

Run standalone with `npx naisys_hub`, or in-process with `npx naisys --integrated-hub`.

## Features

### Core

- WebSocket + REST server with persistence
- `hub-protocol` shared-types package between hub and clients for compile-time safety
- Heartbeat service tracks online runners/supervisors and agent status
- Run-session tracking per run with keep-alive and authoritative online/offline state
- Per-app host filter (naisys-host vs supervisor-host)

### Persistence ([doc 015](../../docs/015-database-design.md))

The hub owns all shared data, so runners stay ephemeral:

- Mail
- Context log and attachments ([doc 011](../../docs/011-mail-attachments.md))
- Cost tracking
- Variables

### Multi-machine

- Hub is the single source of truth ([doc 005](../../docs/005-multi-machine-redux.md)); runners are ephemeral
- Duplicate host-connection prevention; a new connection supersedes a dead one

### Security ([doc 010](../../docs/010-hub-security.md))

- `Authorization: Bearer` header auth
- Rotatable hub access key
- Hardened spawning: no shell interpretation, timeouts on `execFileSync` to prevent hangs
- Public attachment IDs; API key read from headers, not query params
- Hub socket served at `/hub` path for reverse-proxy friendliness (TLS terminated at the proxy)

### Packaging and deployment

- Reverse-proxy-friendly path strategy `<app>/api/...`
- Unified port strategy ([doc 009](../../docs/009-port-strategy.md))
- npm-published bin entry points: `naisys`, `naisys_hub`, `naisys_supervisor`, `naisys_erp`
- Ngrok support (skip-browser-warning header + setup guide)
- PWA manifest, favicons, Apple/Android icons
- Shrinkwrap lockfile to prevent third-party upgrades from breaking the app

## License

MIT

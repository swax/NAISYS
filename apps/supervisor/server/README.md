# @naisys/supervisor (server)

[← Back to Supervisor](../README.md) | [← Back to main README](../../../README.md)

Fastify server for the NAISYS Supervisor. Connects to the hub over Socket.IO for live data, serves the bundled React client, and exposes a permission-aware REST API that's also callable by agents via `ns-api` thanks to HATEOAS action gating.

This is the npm-published half of `@naisys/supervisor` — the bundled client lives in `../client/` at dev time and gets copied into `client-dist/` for publish. Data lives in the hub ([`@naisys/hub-database`](../../../packages/hub-database/README.md)); the supervisor owns only auth/session/passkey state in [`@naisys/supervisor-database`](../../../packages/supervisor-database/README.md).

## Running

Standalone (against an existing hub):

```bash
npm install @naisys/supervisor
npx naisys-supervisor
```

See the [Supervisor README](../README.md) for full configuration (`NAISYS_FOLDER`, `HUB_URL`, `SERVER_PORT`, `PUBLIC_READ`) and feature list.

Dev mode (from monorepo):

```bash
npm run dev --workspace=@naisys/supervisor
```

## Structure

- **`supervisorServer.ts`** — Fastify bootstrap, hub Socket.IO client, static client, swagger/scalar API reference
- **`routes/`** — per-resource routes (agents, users, mail, hosts, runs, costs, variables, etc.) with co-located HATEOAS action/link builders
- **`services/`** — business logic kept out of routes
- **`database/`** — supervisor DB wiring, schema-version checks, migration deploy
- **`hateoas.ts`** / **`schemaRegistry.ts`** / **`routeHelpers.ts`** — generic HATEOAS helpers, per-endpoint schema discovery, response helpers
- **`authMiddleware.ts`** — session + API-key authentication, permission gating (`permGate`)
- **`paging.ts`** — forward/backward pagination
- **`tests/`** — Vitest unit/integration tests

## API design

- HATEOAS-driven REST API — see [doc 012](../../../docs/012-hateoas.md). The same permission system gates both UI buttons and API endpoints
- Disabled actions include a reason
- Scalar UI for API reference (gated behind auth); OpenAPI spec hidden from agents

## Auth ([doc 007](../../../docs/007-web-auth.md))

- Passkey-first WebAuthn login, optional bcrypt password
- One-time registration tokens (QR-code-friendly), step-up auth on sensitive operations
- Multi-session support; cookie sharing with co-hosted ERP
- Bootstrap superadmin via printed registration URL on first run
- Per-user/agent API keys with rotation

## Live data

Heartbeat-driven agent/host status, live mail/chat, run logs with attachments — all pushed from the hub over Socket.IO. The supervisor is a thin UI + API layer; the hub is the source of truth.

## Scripts

- `npm run dev` — `tsx watch` against `src/supervisorServer.ts`
- `npm run build` — `tsc`
- `npm run bundle` — copy the built client into `client-dist/` for publish
- `npm run start` — run `dist/supervisorServer.js`
- `npm test` — Vitest

## License

MIT

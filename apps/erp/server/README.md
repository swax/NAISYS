# @naisys/erp (server)

[← Back to ERP](../README.md) | [← Back to main README](../../../README.md)

Fastify server for the NAISYS ERP. Owns the ERP database (Prisma + SQLite), serves the REST API, hosts the bundled React client, and exposes an agent-facing HATEOAS API discoverable at runtime.

This is the npm-published half of `@naisys/erp` — the bundled client lives in `../client/` at dev time and gets copied into `client-dist/` for publish.

## Running

Standalone:

```bash
npm install @naisys/erp
npx naisys-erp
```

See the [ERP README](../README.md) for the full configuration (`NAISYS_FOLDER`, `SERVER_PORT`, `SUPERVISOR_AUTH`, `PUBLIC_READ`) and feature list.

Dev mode (from monorepo):

```bash
npm run dev --workspace=@naisys/erp
```

## Structure

- **`erpServer.ts`** — Fastify bootstrap (cookies, CORS, multipart, rate limit, static client, swagger/scalar API ref)
- **`erpRoutes.ts`** — route registration entry point
- **`routes/`** — per-resource routes (orders, operations, steps, fields, items, etc.) with co-located HATEOAS action/link builders
- **`services/`** — business logic kept out of routes
- **`database/`** — Prisma client wiring, schema-version check, migration deploy
- **`hateoas.ts`** / **`schemaRegistry.ts`** / **`route-helpers.ts`** — generic HATEOAS helpers, per-endpoint schema discovery, slim-response helpers
- **`middleware/`** — auth, permission gating
- **`tests/`** — Vitest API tests and Playwright UI E2E

## API design

- HATEOAS-driven discoverable REST API — see [doc 012](../../../docs/012-hateoas.md)
- Disabled actions include a reason so agents understand the gate
- Batch endpoints, slim responses on mutations, per-endpoint schema (not bulk OpenAPI)
- Zod-validated multipart input with type coercion and hints
- Hash-based attachment storage for step fields

## Auth

- Local ERP auth, or shared session/passkey auth with supervisor when `SUPERVISOR_AUTH=true` (see [doc 007](../../../docs/007-web-auth.md))
- Agent API keys for cross-app calls

## Scripts

- `npm run dev` — `tsx watch` against `src/erpServer.ts`
- `npm run build` — Prisma generate + tsc
- `npm run bundle` — copy the built client into `client-dist/` for publish
- `npm run start` — run `dist/erpServer.js`
- `npm test` — Vitest + Playwright

## License

MIT

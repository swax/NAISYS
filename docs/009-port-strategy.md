# Port Assignment Strategy

## Numbering Scheme

Ports are grouped by doubled thousands digits to avoid collisions with common services:

| Range  | Purpose     |
| ------ | ----------- |
| `22xx` | Dev clients |
| `33xx` | Servers     |
| `44xx` | E2E tests   |

Within each range, ports are assigned sequentially.

## Unified Server Port

All server apps (Hub, Supervisor, ERP) use the same `SERVER_PORT` env var. When running together in the same process, they share a single port via nested Fastify plugin registration:

- Hub registers the Supervisor plugin
- Supervisor registers the ERP plugin

Each server can also run standalone on its own default port. Hub binds to `0.0.0.0` for external access; Supervisor and ERP default to localhost.

## Dev / Production Ports

| Port | Service           | Env Var       |
| ---- | ----------------- | ------------- |
| 2201 | Supervisor client | (Vite config) |
| 2202 | ERP client        | (Vite config) |
| 3300 | Hub server        | `SERVER_PORT` |
| 3301 | Supervisor server | `SERVER_PORT` |
| 3302 | ERP server        | `SERVER_PORT` |

When running NAISYS with `--integrated-hub --supervisor --erp`, all servers share the Hub's `SERVER_PORT` (default 3300).

## E2E Test Ports

Tests use the `44xx` range so they never collide with dev servers.

| Port | Test File                 | Service      |
| ---- | ------------------------- | ------------ |
| 4401 | crosshub-mail.e2e.test.ts | Hub instance |
| 4402 | erp-api-key.e2e.test.ts   | Hub instance |
| 4403 | basic-mail.e2e.test.ts    | Hub instance |
| 4404 | supervisor-ui.e2e.test.ts | Hub instance |

Each test file picks unique ports within the `44xx` range. When adding a new e2e test, pick the next unused port.

## External Services (not managed by us)

NAISYS's own databases are SQLite (hub, supervisor, and erp each have their own Prisma schema with `provider = "sqlite"`), so there is no Postgres port for NAISYS itself. The external ports below are only relevant to the Odoo MCP integration target.

| Port | Service       | Notes                                              |
| ---- | ------------- | -------------------------------------------------- |
| 5555 | Prisma Studio | `npm run prisma:studio` — inspects SQLite DBs      |
| 5432 | PostgreSQL    | Backing store for Odoo when running it locally     |
| 8069 | Odoo          | ERP integration target, accessed via `odoo` MCP    |

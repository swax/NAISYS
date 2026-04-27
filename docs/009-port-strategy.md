# Port Assignment Strategy

## Numbering Scheme

Ports are grouped by doubled thousands digits to avoid collisions with common services:

| Range  | Purpose     |
| ------ | ----------- |
| `22xx` | Dev clients |
| `33xx` | Servers     |

Within each range, ports are assigned sequentially. E2E tests no longer
use a fixed range; see "E2E Test Ports" below.

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

E2E tests allocate a free OS-assigned port at runtime via `getFreePort()`
in `apps/naisys/src/__tests__/e2e/e2eTestHelper.ts`. Each test calls it
in `beforeEach` and stores the result in a `let SERVER_PORT: number`,
deriving any URLs it needs after that. There is no static port table to
keep in sync, and tests never collide regardless of how they are
scheduled.

## External Services (not managed by us)

NAISYS's own databases are SQLite (hub, supervisor, and erp each have their own Prisma schema with `provider = "sqlite"`), so there is no Postgres port for NAISYS itself. The external ports below are only relevant to the Odoo MCP integration target.

| Port | Service       | Notes                                           |
| ---- | ------------- | ----------------------------------------------- |
| 5555 | Prisma Studio | `npm run prisma:studio` — inspects SQLite DBs   |
| 5432 | PostgreSQL    | Backing store for Odoo when running it locally  |
| 8069 | Odoo          | ERP integration target, accessed via `odoo` MCP |

# Port Assignment Strategy

## Numbering Scheme

Ports are grouped by doubled thousands digits to avoid collisions with common services:

| Range  | Purpose          |
| ------ | ---------------- |
| `22xx` | Dev clients      |
| `33xx` | Servers          |
| `44xx` | E2E tests        |

Within each range, ports are assigned sequentially.

## Unified Server Port

All server apps (Hub, Supervisor, ERP) use the same `SERVER_PORT` env var. When running together in the same process, they share a single port — Supervisor and ERP register as Fastify plugins inside the Hub.

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

| Port | Service       | Notes                   |
| ---- | ------------- | ----------------------- |
| 5432 | PostgreSQL    | Standard default        |
| 5555 | Prisma Studio | `npm run prisma:studio` |
| 8069 | Odoo          | ERP integration target  |

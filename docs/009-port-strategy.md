# Port Assignment Strategy

## Numbering Scheme

Ports follow a 4-digit pattern: `[environment][service][variant][role]`

| Digit | Position  | Values                                         |
| ----- | --------- | ---------------------------------------------- |
| 1st   | Thousands | `3` = dev/production, `4` = e2e tests          |
| 2nd   | Hundreds  | `0` = Supervisor, `1` = Hub, `2` = ERP         |
| 3rd   | Tens      | `0` = default instance, `1`+ = extra instances |
| 4th   | Ones      | `1` = server, `2` = client                     |

## Unified Server Port

All server apps (Hub, Supervisor, ERP) use the same `SERVER_PORT` env var. When running together in the same process, they share a single port — Supervisor and ERP register as Fastify plugins inside the Hub.

## Dev / Production Ports

| Port | Service           | Env Var       |
| ---- | ----------------- | ------------- |
| 3001 | Supervisor server | `SERVER_PORT` |
| 3002 | Supervisor client | (Vite config) |
| 3101 | Hub server        | `SERVER_PORT` |
| 3201 | ERP server        | `SERVER_PORT` |
| 3202 | ERP client        | (Vite config) |

When running NAISYS with `--integrated-hub --supervisor --erp`, all servers share the Hub's `SERVER_PORT` (default 3101).

## E2E Test Ports

Tests use the `4xxx` range so they never collide with dev servers.

| Port | Test File                 | Service      |
| ---- | ------------------------- | ------------ |
| 4101 | crosshub-mail.e2e.test.ts | Hub instance |
| 4111 | erp-api-key.e2e.test.ts   | Hub instance |
| 4121 | basic-mail.e2e.test.ts    | Hub instance |
| 4131 | supervisor-ui.e2e.test.ts | Hub instance |

Each test file picks unique ports within the `4xxx` range. When adding a new e2e test that needs a server, pick the next unused port following the scheme.

## External Services (not managed by us)

| Port | Service       | Notes                   |
| ---- | ------------- | ----------------------- |
| 5432 | PostgreSQL    | Standard default        |
| 5555 | Prisma Studio | `npm run prisma:studio` |
| 8069 | Odoo          | ERP integration target  |

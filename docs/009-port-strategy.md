# Port Assignment Strategy

## Numbering Scheme

Ports follow a 4-digit pattern: `[environment][service][variant][role]`

| Digit | Position  | Values                                         |
| ----- | --------- | ---------------------------------------------- |
| 1st   | Thousands | `3` = dev/production, `4` = e2e tests          |
| 2nd   | Hundreds  | `0` = Supervisor, `1` = Hub, `2` = ERP         |
| 3rd   | Tens      | `0` = default instance, `1`+ = extra instances |
| 4th   | Ones      | `1` = server, `2` = client, `3` = integrated   |

## Dev / Production Ports

| Port | Service               | Env Var           |
| ---- | --------------------- | ----------------- |
| 3001 | Supervisor server     | `SUPERVISOR_PORT` |
| 3002 | Supervisor client     | (Vite config)     |
| 3003 | Supervisor integrated | `SUPERVISOR_PORT` |
| 3101 | Hub server            | `HUB_PORT`        |
| 3103 | Hub integrated        | `HUB_PORT`        |
| 3201 | ERP server            | `ERP_PORT`        |
| 3202 | ERP client            | (Vite config)     |

**Integrated** ports are used when NAISYS runs with `--supervisor` or `--integrated-hub` flags, starting the service in the same process space. These use distinct ports so they don't collide with standalone dev servers.

## E2E Test Ports

Tests use the `4xxx` range so they never collide with dev servers.

| Port | Test File                 | Service             |
| ---- | ------------------------- | ------------------- |
| 4012 | erp-api-key.e2e.test.ts   | Supervisor instance |
| 4101 | crosshub-mail.e2e.test.ts | Hub instance        |
| 4111 | erp-api-key.e2e.test.ts   | Hub instance        |
| 4121 | basic-mail.e2e.test.ts    | Hub instance        |

Each test file picks unique ports within the `4xxx` range. When adding a new e2e test that needs a server, pick the next unused port following the scheme.

## External Services (not managed by us)

| Port | Service       | Notes                   |
| ---- | ------------- | ----------------------- |
| 5432 | PostgreSQL    | Standard default        |
| 5555 | Prisma Studio | `npm run prisma:studio` |
| 8069 | Odoo          | ERP integration target  |

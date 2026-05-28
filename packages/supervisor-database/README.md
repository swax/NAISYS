# @naisys/supervisor-database

[← Back to packages](../README.md) | [← Back to main README](../../README.md)

Prisma schema and generated client for the NAISYS **supervisor** database (the hub has its own DB — see [`@naisys/hub-database`](../hub-database/README.md)).

For the overall database strategy (Prisma rationale, the three schemas, migration flow, connection conventions), see [doc 001 — Database Design](../../docs/001-database-design.md).

## Overview

This package provides:

- Prisma schema definitions for the supervisor database
- Generated Prisma Client for type-safe database access
- Auth/session helpers shared between the supervisor and ERP servers when they're co-hosted ([doc 007 — Web Auth](../../docs/007-web-auth.md))
- TypeScript types for all database models

## Database Schema

Supervisor-owned tables include user accounts, sessions, passkey credentials, optional passwords, registration tokens, API keys, and permission assignments. See `prisma/schema.prisma` for the full schema.

## Services

The package exports lightweight services that own auth/session logic so it stays consistent between supervisor and ERP:

- **`sessionService`** — create/find/delete sessions, ensure superadmin on first run, look up users by API key
- **`passkeyService`** — WebAuthn credential CRUD, registration tokens, device-label rename
- **`passwordService`** — optional bcrypt password add/change/remove/verify

## Development

### Updating the Schema

1. Update `prisma/schema.prisma`
2. Create a migration: `npm run prisma:migrate` (generates a SQL migration under `prisma/migrations/`)
3. Bump `SUPERVISOR_DB_VERSION` in `src/dbConfig.ts` — on startup the supervisor compares this constant to the `schema_version` row and deploys pending migrations only when it's higher. If you skip this step, your new migration will not run in existing deployments.
4. Generate the new client: `npm run prisma:generate`
5. Build the package: `npm run build`

## Scripts

- `npm run build` - Generate Prisma Client and compile TypeScript
- `npm run clean` - Remove `dist/`
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:migrate` - Create a new migration (`prisma migrate dev --create-only`)
- `npm run prisma:studio` - Open Prisma Studio against the supervisor DB

## Environment Variables

- `NAISYS_FOLDER` - Path to NAISYS data folder (optional for client generation, required at runtime)

## Type Exports

All Prisma types are exported for use in other packages:

```typescript
import type { users, sessions, passkey_credentials } from "@naisys/supervisor-database";
```

## Notes

- The database path is configured dynamically at runtime
- The Prisma Client is generated to `src/generated/prisma/`
- Foreign key constraints are enabled at runtime

## License

MIT

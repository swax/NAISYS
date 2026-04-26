# @naisys/hub-database

[← Back to packages](../README.md) | [← Back to main README](../../README.md)

Prisma schema and generated client for the NAISYS **hub** database (the supervisor has its own DB — see `@naisys/supervisor-database`).

For the overall database strategy (Prisma rationale, the three schemas, migration flow, connection conventions), see [doc 001 — Database Design](../../docs/001-database-design.md).

## Overview

This package provides:

- Prisma schema definitions for the hub database
- Generated Prisma Client for type-safe database access
- TypeScript types for all database models

## Database Schema

Hub-owned tables:

- **users** / **user_hosts** / **user_notifications** - User accounts, host bindings, latest mail/log pointers
- **hosts** - Registered NAISYS host instances
- **mail_messages** / **mail_recipients** / **mail_attachments** - Flat (non-threaded) mail model (see [doc 002](../../docs/002-revised-llmail-plan.md))
- **attachments** - Generic attachment blobs (mail/chat, see [doc 011](../../docs/011-mail-attachments.md))
- **context_log** - Agent conversation and activity logs
- **run_session** - Agent run sessions with timing, model, and cost info
- **costs** - API cost tracking with token usage
- **models** - Model metadata / pricing
- **config_revisions** - Agent/system config revision history
- **variables** - Shared variables
- **schema_version** - Schema version tracking for migrations

## Development

### Updating the Schema

If you need to update the database schema:

1. Update `prisma/schema.prisma`
2. Create a migration: `npm run prisma:migrate` (generates a SQL migration under `prisma/migrations/`)
3. Bump `HUB_DB_VERSION` in `src/dbConfig.ts` — on startup the hub compares this constant to the `schema_version` row and deploys pending migrations only when it's higher. If you skip this step, your new migration will not run in existing deployments.
4. Generate the new client: `npm run prisma:generate`
5. Build the package: `npm run build`

### Reiniting the db for a breaking change

1. Delete the existing db files in NAISYS_FOLDER
2. Delete migration files
3. Run `npm run prisma:migrate` and enter name 'init' when prompted

## Scripts

- `npm run build` - Generate Prisma Client and compile TypeScript
- `npm run clean` - Remove `dist/`
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:migrate` - Create a new migration (`prisma migrate dev --create-only`)

## Environment Variables

- `NAISYS_FOLDER` - Path to NAISYS data folder (optional for client generation, required at runtime)

## Type Exports

All Prisma types are exported for use in other packages:

```typescript
import type { users, costs, context_log, mail_messages } from "@naisys/hub-database";
```

## Notes

- The database path is configured dynamically at runtime
- Prisma `DateTime` fields are exposed as JavaScript `Date` values by the generated client; API/protocol layers serialize them as ISO strings where needed
- The Prisma Client is generated to `src/generated/prisma/`
- Foreign key constraints are enabled at runtime

## License

MIT

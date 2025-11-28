# @naisys/database

[← Back to packages](../README.md) | [← Back to main README](../../README.md)

Shared database schema and Prisma client for NAISYS monorepo.

## Overview

This package provides:

- Prisma schema definitions for the NAISYS database
- Generated Prisma Client for type-safe database access
- TypeScript types for all database models
- Shared database utilities

## Database Schema

The NAISYS database contains the following tables:

- **Users** - Agent users with authentication and profile info
- **Costs** - API cost tracking with token usage
- **ContextLog** - Agent conversation and activity logs
- **Threads** - Message thread management
- **ThreadMembers** - Thread membership and participation
- **ThreadMessages** - Individual messages in threads

## Development

### Updating the Schema

If you need to update the database schema:

1. Update `prisma/schema.prisma`
2. Generate the new client: `npm run prisma:generate`
3. Build the package: `npm run build`

### View Database with Prisma Studio

The database url must be set to a hardcoded value in `prisma/schema.prisma` for Prisma Studio to work.

```bash
npm run prisma:studio
```

This opens a visual database browser at http://localhost:5555

## Scripts

- `npm run build` - Generate Prisma Client and compile TypeScript
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:studio` - Open Prisma Studio
- `npm run prisma:pull` - Pull schema from existing database

## Environment Variables

- `NAISYS_FOLDER` - Path to NAISYS data folder (optional for client generation, required at runtime)

## Type Exports

All Prisma types are exported for use in other packages:

```typescript
import type { Users, Costs, ContextLog, Threads } from "@naisys/database";
```

## Notes

- The database path is configured dynamically at runtime
- All date fields use ISO string format
- The Prisma Client is generated to `src/generated/prisma/`
- Foreign key constraints are enabled at runtime

## License

MIT

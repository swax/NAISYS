# @naisys/database

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
- **DreamLog** - Inter-session memory for agents
- **Threads** - Message thread management
- **ThreadMembers** - Thread membership and participation
- **ThreadMessages** - Individual messages in threads

## Installation

This package is used as a workspace dependency:

```json
{
  "dependencies": {
    "@naisys/database": "file:../../packages/database"
  }
}
```

Then run `npm install` at the monorepo root.

## Usage

### Basic Usage with PrismaClient

```typescript
import { PrismaClient } from "@naisys/database";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:/path/to/naisys.sqlite`,
    },
  },
});

// Query users
const users = await prisma.users.findMany();

// Create a cost entry
await prisma.costs.create({
  data: {
    date: new Date().toISOString(),
    username: "agent1",
    source: "api",
    model: "claude-3",
    cost: 0.05,
    input_tokens: 1000,
    output_tokens: 500,
  },
});

// Get context logs with filtering
const logs = await prisma.contextLog.findMany({
  where: { username: "agent1" },
  orderBy: { id: "desc" },
  take: 100,
});
```

### Dynamic Database Path

The database path is typically constructed from the `NAISYS_FOLDER` environment variable:

```typescript
import { PrismaClient } from "@naisys/database";
import path from "path";

const dbPath = path.join(
  process.env.NAISYS_FOLDER,
  "database",
  "naisys.sqlite"
);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}`,
    },
  },
});
```

## Development

### Updating the Schema

If you need to update the database schema:

1. Update `prisma/schema.prisma`
2. Generate the new client: `npm run prisma:generate`
3. Build the package: `npm run build`

### Pull Schema from Existing Database

If the database schema was changed externally:

```bash
npm run prisma:pull
npm run build
```

### View Database with Prisma Studio

```bash
npm run prisma:studio
```

This opens a visual database browser at http://localhost:5555

## Scripts

- `npm run build` - Generate Prisma Client and compile TypeScript
- `npm run compile` - Compile TypeScript only
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

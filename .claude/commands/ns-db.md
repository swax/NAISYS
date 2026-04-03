Access the NAISYS database directly for queries and troubleshooting.

There are three SQLite databases:

1. **Hub** — agents, runs, sessions, costs
   - Schema: `packages/hub-database/prisma/schema.prisma`
2. **Supervisor** — lightweight, mostly auth for supervisor users
   - Schema: `packages/supervisor-database/prisma/schema.prisma`
3. **ERP** — orders, operations, steps, items, etc.
   - Schema: `apps/erp/server/prisma/schema.prisma`

Database locations:

- Dev: `~/.naisys/database/`
- SCDB: `/var/scdb-ops/naisys/database/`

Database names:

- naisys_hub.db
- supervisor
- naisys_erp.db

Read the relevant schema.prisma file to understand the table structure before
querying. Use `sqlite3` to run queries against the database files.

User's request: $ARGUMENTS

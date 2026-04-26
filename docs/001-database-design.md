# Database Design

[← Back to main README](../README.md)

This doc covers the database strategy for NAISYS — why Prisma, how the
schemas are split, how migrations roll out, and the conventions that keep
queries safe and portable. For the actual table definitions see each
package's `schema.prisma`.

## Why Prisma

NAISYS uses [Prisma](https://www.prisma.io/) as its ORM across every
server-side package. The decision boils down to a few properties that are
hard to get any other way:

- **No raw SQL in application code.** Application logic talks to typed
  models, not strings. That keeps the codebase portable: SQLite is the
  default today, but the same query code can target PostgreSQL by
  switching the `provider` and re-running migrations. Larger
  multi-machine deployments with many concurrent agents are the obvious
  reason to graduate to Postgres later.
- **Field deploys are just `npm install`.** Add a column → `prisma
  migrate dev` writes a versioned migration file → commit and publish.
  On the next app start, `migrationHelper.ts` checks the on-disk DB
  version and runs any pending migrations automatically — no manual
  SQL, no separate ops step, no hand-written upgrade tooling for
  installs in the field. See [Migrations](#migrations-versioned-automatic-fast-path)
  below for the mechanics.
- **Static typing.** The generated client knows every column, relation,
  and enum. Adding a field to `schema.prisma` and re-running
  `prisma generate` immediately surfaces every call site that needs to be
  updated, instead of failing at runtime.
- **Composable queries.** `where` clauses, `include` trees, and
  `orderBy` are plain TypeScript objects, so conditional filters compose
  the same way any other object does — assemble a `where` object across
  several `if` branches and Prisma still type-checks the result. Examples
  in `apps/supervisor/server/src/services/runsService.ts`.
- **Raw SQL escape hatch.** When the ORM gets in the way (PRAGMAs,
  custom upserts, performance-critical aggregates), `$executeRawUnsafe`
  and `$queryRaw` are right there. We use this for the per-connection
  `journal_mode=WAL`, `synchronous=NORMAL`, and `foreign_keys=ON` PRAGMAs
  in every `prismaClient.ts`.
- **Active project.** Prisma is well maintained, ships frequent releases,
  and has a large enough user base that breaking changes are documented
  and tooling (Studio, the LSP, migrations) keeps pace.

## Three databases, not one

NAISYS currently has three independent Prisma schemas, each with its own
`.db` file under `$NAISYS_FOLDER/database/`:

| Schema                          | File              | Owner                             |
| ------------------------------- | ----------------- | --------------------------------- |
| `packages/hub-database`         | `naisys_hub.db`   | The Hub — agent state, mail, logs, costs, hosts, users |
| `packages/supervisor-database`  | `supervisor.db`   | Supervisor web UI — sessions, web-side concerns |
| `apps/erp/server/prisma`        | `naisys_erp.db`   | ERP — orders, operations, work centers, attachments |

They're split because the apps deploy independently, evolve at different
speeds, and have unrelated data shapes. A schema change in the ERP
shouldn't force a Hub migration, and vice versa. It also keeps the Prisma
client surface in each package small — `@naisys/hub-database` only
generates the Hub's models.

The runner (`naisys`) is intentionally **stateless** and has no database
of its own. All persistence flows through the Hub over WebSocket + REST
(see [doc 000 — Architecture](000-architecture.md)).

## Migrations: versioned, automatic, fast-path

Every schema has a numeric `*_DB_VERSION` constant in its
`dbConfig.ts` — e.g. `HUB_DB_VERSION = 38`, `SUPERVISOR_DB_VERSION = 9`.
The version is bumped whenever a new migration is added.

On startup each app calls `deployPrismaMigrations()` from
`packages/common-node/src/migrationHelper.ts`. The helper:

1. Reads the current version from the `schema_version` table (one row,
   `id = 1`).
2. **Fast path** — if the on-disk version equals the expected version,
   return immediately. Production startups skip Prisma entirely in the
   common case.
3. Otherwise, shell out to `npx prisma migrate deploy` against the
   package's `schema.prisma` and migrations directory.
4. Upsert the new version into `schema_version`.

This means deploying a new release is as simple as updating the npm
package — the next process start migrates the database forward. There is
no manual `prisma migrate` step in production, and no separate ops
playbook for rolling out schema changes.

A few details that matter in practice:

- **Forward only.** If the on-disk version is *newer* than the binary
  expects, the helper throws rather than guessing. Downgrades require
  manual intervention.
- **Stale WAL recovery.** If a previous process crashed mid-write,
  SQLite's `-wal` / `-shm` files can persist and cause the next
  `prisma migrate deploy` to report `database is locked`. The helper
  detects this, removes the stale files, and retries once.
- **Journal-mode handover.** Before closing the version-check connection
  the helper switches journal mode from WAL to DELETE so that `prisma
  migrate deploy` (a separate process) doesn't trip over leftover WAL
  state.

## Connection conventions

Every `prismaClient.ts` in the codebase opens its connection with the
same three PRAGMAs:

```typescript
await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL");
await prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL");
await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON");
```

- **WAL** lets readers and writers proceed concurrently — important when
  several agents and a UI client all hit the Hub at once.
- **synchronous=NORMAL** is safe under WAL and skips an extra `fsync`
  per commit.
- **foreign_keys=ON** is per-connection in SQLite. Without it the schema
  declares relations but the engine doesn't enforce them.

The connection adapter (`@prisma/adapter-better-sqlite3`) uses a 10 s
busy timeout so brief lock contention doesn't surface as errors.

## Naming convention

Tables and columns are **`snake_case`** in `schema.prisma`; the generated
TypeScript client preserves that exactly. Application code is
**`camelCase`**. The two only meet at the Prisma boundary, where each
service does the small mapping it needs. This keeps SQL output readable
in `EXPLAIN` plans, Studio, and ad-hoc queries, while leaving normal
TypeScript untouched.

## Indexes are co-located and annotated

Indexes live inside the `model` block (`@@index([...], map: "...")`)
right next to the columns they cover, and every one carries a comment
explaining the query that justifies it — e.g.

```prisma
@@index([user_id, last_active(sort: Desc)], map: "idx_run_session_user_last_active_desc")
  // WHERE user_id ORDER BY last_active DESC in supervisor runsService pagination
```

Adding an index without a justification, or adding a query that scans
without an index, is easy to spot in review.

## Enum duplication for shared packages

Prisma enums are exported by the generated client, but the client pulls
in `better-sqlite3` (a native module) and the full `@prisma/client`
runtime. That's too heavy for browser bundles and lightweight
shared packages, so a few enums (`MessageKind`, `RecipientType`, etc.)
are **intentionally duplicated** as Zod schemas in
`@naisys/hub-protocol` and `@naisys-supervisor/shared`. A sync test in
`apps/supervisor/server/src/tests/hub-enum-sync.test.ts` fails CI if the
duplicates drift from the Prisma source of truth.

## Inspecting the database

`npm run prisma:studio` in any of the three database packages opens
[Prisma Studio](https://www.prisma.io/studio) at
[http://localhost:5555](http://localhost:5555) — a browsable, editable
view of the live SQLite file. For one-off scripts and ad-hoc reports the
generated client is importable straight from each package
(`@naisys/hub-database`, `@naisys/supervisor-database`, ERP's local
`erpDb.ts`).

## Future considerations

- **PostgreSQL provider.** The portability story above is
  deliberate — once a deployment outgrows SQLite (many concurrent
  agents, multiple Hub processes behind a load balancer), switching the
  `provider` and re-running migrations is the planned path. Application
  code shouldn't need changes.
- **Per-host shards.** A very large multi-machine deployment might
  want per-host log databases that fan into the Hub asynchronously,
  rather than every host writing into the central `context_log` table.
  Prisma's multi-schema and multi-datasource support gives us room to
  do that without rewriting service code.
- **Read replicas.** The Supervisor is read-heavy compared to the Hub.
  When that becomes a contention point, a Postgres read-replica with
  Prisma's `$extends` per-operation routing is the cheapest path.

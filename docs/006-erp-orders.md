# NAISYS ERP - Order Management

**Status: Implemented**

This document is a reference for the NAISYS ERP as it stands today. It started as the design doc for Orders / Revisions / Order Runs and has been brought in sync with the current implementation, which has grown to cover the full manufacturing/task execution flow: Operations, Steps, Field sets, Work Centers, Item Instances (inventory), Labor Tickets, Auth, and Audit.

## Overview

The NAISYS ERP is an AI-first enterprise resource planning system designed to be operated primarily by AI agents and monitored by humans. The core design principle is that an AI agent should be able to start at a single root URL (`GET /erp/api/`) and fully discover, understand, and operate the entire system through HATEOAS (Hypermedia as the Engine of Application State) without any hardcoded knowledge of endpoints or schemas.

## Design Philosophy

### AI-First, Human-Monitored

Traditional ERPs are built for human operators with AI bolted on as an afterthought. NAISYS ERP inverts this: the API is the primary interface, designed for machine consumption, with a web UI layered on top for human oversight and occasional intervention.

This means:

- **Every capability is API-accessible** - The UI is a thin client over the same REST API that agents use
- **Self-describing resources** - Responses include not just data but metadata about what actions are available and what schemas they accept
- **State-driven actions** - The server tells the client what it can do next based on the current resource state, rather than requiring the client to know the state machine
- **No out-of-band knowledge required** - An agent starts at the root URL and discovers everything from there

### HATEOAS as the Navigation Layer

HATEOAS solves the fundamental problem of API coupling: if an agent hardcodes endpoint URLs and request shapes, any API change breaks it. With HATEOAS, the agent follows links and actions provided by the server, making the integration resilient to structural changes.

Every response includes:

- **`_links`** - Navigation to related resources (self, collection, parent, schema, pagination)
- **`_actions`** - Available operations with HTTP method, URL, human-readable title, schema reference, and optionally a pre-filled request body template. Actions the current user cannot perform are returned with a `disabled` reason string rather than omitted, so agents can see what exists but learn why it is unavailable (e.g. missing permission, blocked by predecessors, work-center mismatch).

An agent workflow becomes: fetch resource, read `_actions`, pick the appropriate one, fetch its schema if needed, execute it. No URL construction, no memorizing endpoint paths.

### Schema Discovery

API schemas are discoverable through these complementary mechanisms:

1. **Per-schema endpoint** at `/erp/api/schemas/:name` - Returns a single JSON Schema for a named schema (e.g., `CreateOrder`). This is what HATEOAS `_actions` and `_links` point to, so an agent can fetch only the schema it needs for a specific action without downloading the entire API spec.
2. **Schema catalog** at `/erp/api/schemas/` - Lists all available schema names.
3. **OpenAPI spec** at `/erp/api/openapi.json` - Full machine-readable API contract auto-generated from Zod schemas.
4. **Interactive API reference** at `/erp/api-reference` - Scalar UI for human exploration and testing.

The per-schema endpoint is the primary mechanism for agents. When an agent sees an action like `{ "rel": "update", "schema": "/erp/api/schemas/UpdateOrder" }`, it fetches that URL to get the exact JSON Schema for the request body — field names, types, constraints, enums — without the overhead of the full OpenAPI spec.

## Architecture

### Package Structure

```
apps/erp/
  server/           # Fastify backend, Prisma ORM, SQLite
    bin/            # naisys-erp CLI entry point
    prisma/         # schema.prisma + migrations
    src/
      routes/       # One file per resource (31 route modules)
      services/     # Business logic per domain
      e2e/          # Playwright UI tests (colocated under server/e2e)
      tests/        # Vitest unit tests (enum-sync, openapi-spec, pageSize-cap)
  client/           # React 19 + Vite + Mantine frontend
  shared/           # Zod schemas and TypeScript types shared across client and server
```

The ERP is built as a **Fastify plugin** (`erpPlugin`) that can be:

- **Standalone** — Runs on port `3302` by default (`SERVER_PORT` env var) via `npx naisys-erp`. All paths are served under `/erp/*`.
- **Embedded** — Mounted into the NAISYS supervisor app; when `enableSupervisorAuth` is set, the ERP shares the supervisor's session cookie and API-key store so users authenticated against the supervisor can use the ERP without re-login.

The compiled client is bundled into `server/client-dist/` and served by `@fastify/static`, so a single server process delivers both API and UI.

### Tech Stack

| Layer               | Technology                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| Server runtime      | Node.js ≥ 22                                                                |
| API framework       | Fastify 5 + `fastify-type-provider-zod`                                     |
| Auth / sessions     | `@fastify/cookie`, SHA-256 hashed session tokens in SQLite, `bcryptjs`      |
| Database            | SQLite via Prisma (`@prisma/adapter-better-sqlite3`)                        |
| Schemas             | Zod 4 (shared validation + OpenAPI generation)                              |
| API docs            | `@fastify/swagger` + Scalar (`@scalar/fastify-api-reference`)               |
| Other plugins       | `@fastify/cors`, `@fastify/multipart`, `@fastify/rate-limit`, `@fastify/static` |
| Frontend            | React 19 + Vite + React Router v7                                           |
| UI library          | Mantine (`@mantine/core`, `@mantine/form`, `@mantine/dates`, `@mantine/notifications`) + Tabler Icons |
| Testing             | Vitest (unit), Playwright (API + UI E2E)                                    |

### API Root Discovery

```
GET /erp/api/

{
  "name": "NAISYS ERP API",
  "version": "1.0.0",
  "description": "AI-first ERP system",
  "_links": [
    { "rel": "self", "href": "/erp/api/" },
    { "rel": "me", "href": "/erp/api/auth/me" },
    { "rel": "orders", "href": "/erp/api/orders" },
    { "rel": "items", "href": "/erp/api/items" },
    { "rel": "dispatch", "href": "/erp/api/dispatch" },
    { "rel": "schemas", "href": "/erp/api/schemas/" },
    { "rel": "api-reference", "href": "/erp/api-reference" },
    { "rel": "work-centers", "href": "/erp/api/work-centers" },
    { "rel": "users", "href": "/erp/api/users" },     // admin only
    { "rel": "admin", "href": "/erp/api/admin" }      // admin only
  ],
  "_actions": [
    { "rel": "logout", "href": "/erp/api/auth/logout", "method": "POST" }
  ]
}
```

Unauthenticated requests see a trimmed response that exposes a `login` action (and, if `PUBLIC_READ=true`, the read-only resource links). From the authenticated root an agent can reach every resource it has permission for.

## Data Model

The ERP models a two-track hierarchy: a **plan track** (Orders → Revisions → Operations → Steps → Fields) that describes what should be built, and an **execution track** (Order Runs → Operation Runs → Step Runs → Field Values → Labor Tickets) that tracks what actually happened. Field sets are shared infrastructure used by both Steps (plan) and Items (catalog), and Field Records hold the runtime values filled in during execution.

```
Order ─┬─ OrderRevision ─┬─ Operation ─┬─ Step ── Field
       │                 │             └─ OperationFieldRef (cross-op refs)
       │                 │             └─ OperationDependency (predecessors)
       │                 └─ OrderRun ─── OperationRun ─── StepRun ── FieldValue
       │                                     │                │
       │                                     └─ LaborTicket   └─ FieldAttachment
       │                                     └─ OperationRunComment
       └─ (optional) Item ── ItemInstance (created on OrderRun completion)
```

### Plan Entities

#### Orders

Top-level entity representing a type of work. Optionally linked to an `Item` when the order produces inventory.

| Field       | Type     | Notes                                                    |
| ----------- | -------- | -------------------------------------------------------- |
| id          | int (PK) | Auto-increment                                           |
| key         | string   | Unique slug (`^[a-z0-9-]+$`); used in URLs               |
| description | string   | Free-form description                                    |
| status      | enum     | `active` / `archived`                                    |
| itemId      | int? FK  | Optional link to an Item; constrains completion flow     |
| created_by/at, updated_by/at | audit | Tracked on every entity below unless noted |

#### Order Revisions

Versioned snapshots of an order that go through an approval workflow. Revisions are what `OrderRun`s are created from.

| Field          | Type     | Notes                                 |
| -------------- | -------- | ------------------------------------- |
| id             | int (PK) | Auto-increment                        |
| orderId        | int (FK) | Parent order                          |
| revNo          | int      | Auto-incremented per order            |
| status         | enum     | `draft` / `approved` / `obsolete`     |
| description    | string   | Revision body                         |
| changeSummary  | string?  | What changed since previous revision  |

**Unique constraint**: `(orderId, revNo)`.

Revisions expose a diff endpoint that compares against the last approved revision, used by the UI when editing a draft.

#### Operations

Ordered steps within a revision. Each Operation may run at a specific `WorkCenter` and may depend on predecessor Operations in the same revision.

| Field        | Type     | Notes                                              |
| ------------ | -------- | -------------------------------------------------- |
| id           | int (PK) | Auto-increment                                     |
| orderRevId   | int (FK) | Parent revision                                    |
| seqNo        | int      | Sequence number within the revision                |
| title        | string   | Display name                                       |
| description  | string   | Detail / markdown                                  |
| workCenterId | int? FK  | Optional gating work center                        |

**Unique constraint**: `(orderRevId, seqNo)`.

#### Operation Dependencies

Directed links between two Operations in the same revision. Used at run time to compute whether an `OperationRun` is `blocked`.

| Field         | Type     | Notes                                   |
| ------------- | -------- | --------------------------------------- |
| successorId   | int (FK) | The Operation that waits                |
| predecessorId | int (FK) | The Operation that must complete first  |

`@@unique([successorId, predecessorId])`. Deletes cascade when either side is deleted.

#### Steps

Work instructions nested under an Operation. Each Step may have a `FieldSet` attached to capture structured data during execution, and may be `multiSet` to allow the executor to enter multiple rows of field values.

| Field        | Type     | Notes                                        |
| ------------ | -------- | -------------------------------------------- |
| id           | int (PK) | Auto-increment                               |
| operationId  | int (FK) | Parent operation                             |
| seqNo        | int      | Sequence number within operation             |
| title        | string   | Step name                                    |
| instructions | string   | Markdown instructions                        |
| multiSet     | bool     | Allow multiple value sets per step run       |
| fieldSetId   | int? FK  | Field template for this step                 |

**Unique constraint**: `(operationId, seqNo)`.

#### Fields (on a FieldSet)

Typed input definitions attached to a `FieldSet`. `FieldSet`s are reused between Steps and Items, so the same field plumbing drives both step data collection and item-instance metadata.

| Field       | Type     | Notes                                                                 |
| ----------- | -------- | --------------------------------------------------------------------- |
| id          | int (PK) | Auto-increment                                                        |
| fieldSetId  | int (FK) | Parent field set                                                      |
| seqNo       | int      | Order                                                                 |
| label       | string   | Display label                                                         |
| type        | enum     | `string` / `number` / `date` / `datetime` / `yesNo` / `checkbox` / `attachment` |
| isArray     | bool     | Whether field holds multiple values (API type string appends `[]`)    |
| required    | bool     | Whether the value must be filled before the step can complete         |

#### Operation Field Refs

Lets an Operation surface (read-only) field values that were captured by an earlier Operation's Step. Useful when a later operator needs to see measurements taken upstream without re-entering them.

| Field        | Type     | Notes                                 |
| ------------ | -------- | ------------------------------------- |
| operationId  | int (FK) | Operation that references             |
| seqNo        | int      | Display order within the operation    |
| title        | string   | Label shown to the executor           |
| sourceStepId | int (FK) | Step whose fields are being surfaced  |

`@@unique([operationId, seqNo])` and `@@unique([operationId, sourceStepId])`.

#### Work Centers

A physical or logical location where Operations are performed. Users are assigned to Work Centers; only assigned users (or admins) can start/complete an `OperationRun` whose Operation is gated to a Work Center.

| Field       | Type     | Notes                                   |
| ----------- | -------- | --------------------------------------- |
| id          | int (PK) | Auto-increment                          |
| key         | string   | Unique slug                             |
| description | string   | Free-form                               |

`WorkCenterUser` is the join table (composite PK `[workCenterId, userId]`).

#### Items

Catalog entries that an Order may produce. An Item carries a `FieldSet` that acts as the template for every `ItemInstance` produced from runs of that item's orders.

| Field       | Type     | Notes                                 |
| ----------- | -------- | ------------------------------------- |
| id          | int (PK) | Auto-increment                        |
| key         | string   | Unique slug                           |
| description | string   | Free-form                             |
| fieldSetId  | int? FK  | Template for instance field values    |

### Execution Entities

#### Order Runs

Concrete work requests created from an approved revision. Track the actual execution.

| Field       | Type     | Notes                                                     |
| ----------- | -------- | --------------------------------------------------------- |
| id          | int (PK) | Auto-increment                                            |
| runNo       | int      | Auto-incremented per order                                |
| orderId     | int (FK) | Parent order                                              |
| orderRevId  | int (FK) | Revision snapshot used to spawn OperationRuns             |
| status      | enum     | `released` / `started` / `closed` / `cancelled`           |
| priority    | enum     | `low` / `medium` / `high` / `critical`                    |
| cost        | float?   | Rolled up from labor tickets on completion                |
| dueAt       | string?  | ISO deadline                                              |
| releaseNote | string?  | Context for operators                                     |

**Unique constraint**: `(orderId, runNo)`.

When an `OrderRun` is created, the system materializes an `OperationRun` for every Operation in the chosen revision, pre-computing each one's initial `blocked`/`pending` status from its dependencies.

#### Operation Runs

Execution records for Operations within an OrderRun. `assignedTo` is optional and can be auto-set to the current user when they start the run.

| Field          | Type      | Notes                                                                                          |
| -------------- | --------- | ---------------------------------------------------------------------------------------------- |
| id             | int (PK)  | Auto-increment                                                                                 |
| orderRunId     | int (FK)  | Parent order run                                                                               |
| operationId    | int (FK)  | Source operation                                                                               |
| status         | enum      | `blocked` / `pending` / `in_progress` / `completed` / `skipped` / `failed`                     |
| assignedToId   | int? (FK) | Responsible user                                                                               |
| cost           | float?    | Rolled up from labor tickets on completion                                                     |
| statusNote     | string?   | Note captured on the most recent transition                                                    |
| completedAt    | datetime? | Set when status moves to `completed` / `skipped` / `failed`                                    |

**Unique constraint**: `(orderRunId, operationId)`. Blocked runs auto-unblock to `pending` when their last predecessor completes.

#### Step Runs

Execution records for Steps within an OperationRun. Each StepRun owns a `FieldRecord` (its per-run instance of the Step's `FieldSet`) that holds the captured `FieldValue` rows.

| Field          | Type      | Notes                                      |
| -------------- | --------- | ------------------------------------------ |
| id             | int (PK)  | Auto-increment                             |
| operationRunId | int (FK)  | Parent operation run                       |
| stepId         | int (FK)  | Source step                                |
| fieldRecordId  | int? (FK) | Container for captured field values        |
| completed      | bool      | Simple done/not-done toggle                |
| statusNote     | string?   | Note captured on the most recent toggle    |

#### Field Values and Attachments

A `FieldRecord` holds the concrete `FieldValue` rows captured against a Step's (or Item Instance's) `FieldSet`. Each value is identified by `(fieldRecordId, fieldId, setIndex)` — `setIndex > 0` is only used by `multiSet` steps to represent additional repeated rows. Attachment-typed fields link through `FieldAttachment` to the shared `Attachment` table, which deduplicates uploads by `fileHash`.

#### Item Instances

Inventory records produced by completing an `OrderRun` whose Order is linked to an Item. The Item's `FieldSet` is used as the template; captured values live on a fresh `FieldRecord`.

| Field         | Type      | Notes                                             |
| ------------- | --------- | ------------------------------------------------- |
| id            | int (PK)  | Auto-increment                                    |
| itemId        | int (FK)  | Parent item                                       |
| orderRunId    | int? (FK) | The order run that produced this instance         |
| fieldRecordId | int? (FK) | Captured template field values                    |
| key           | string    | Instance identifier (unique per item)             |
| quantity      | float?    | Optional numeric quantity                         |

**Unique constraint**: `(itemId, key)`.

#### Labor Tickets

Clock-in/clock-out time tracking against an `OperationRun`. An operation cannot complete while any of its tickets are still open; `cost` and `OperationRun.cost` are rolled up from closed tickets.

| Field          | Type      | Notes                               |
| -------------- | --------- | ----------------------------------- |
| operationRunId | int (FK)  | Target operation run                |
| userId         | int (FK)  | Worker                              |
| clockIn        | datetime  | Required                            |
| clockOut       | datetime? | Null while ticket is open           |
| cost           | float?    | Computed on clock-out               |

#### Operation Run Comments

Free-form notes/issues/feedback attached to an OperationRun.

| Field          | Type     | Notes                                   |
| -------------- | -------- | --------------------------------------- |
| operationRunId | int (FK) | Target operation run                    |
| type           | enum     | `note` / `issue` / `feedback`           |
| body           | string   | Markdown comment                        |

### Users, Permissions, Sessions

The `User` model stores local accounts (`passwordHash`, optional `apiKey`) and supports agent users (`isAgent = true`). Every audit-bearing entity references its creator/updater through `createdById` / `updatedById`.

`UserPermission` grants one of the following `ErpPermission` values to a user:

| Permission        | Grants                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `erp_admin`       | Full access; bypasses work-center gating; manage users and permissions                    |
| `order_planner`   | Create and edit orders, revisions, operations, steps, fields, dependencies, field refs    |
| `order_manager`   | Manage order runs: create, cancel, reopen, reassign, fail operations, delete              |
| `order_executor`  | Start / complete / skip operations, clock in/out, complete steps, add comments            |
| `item_manager`    | CRUD items and item instances                                                             |

`Session` stores SHA-256 hashes of opaque session tokens (never the raw tokens). When supervisor auth is enabled, the ERP also accepts the supervisor's session cookie and agent API keys via `@naisys/supervisor-database` / `@naisys/hub-database` lookups.

### Audit Log

Every write path records an `AuditLog` row: `(entityType, entityId, action, field, oldValue, newValue, userId, createdAt)`. The `field` column is used for field-level diffs on updates; `create`/`delete` actions emit a single summary row. The log is queryable at `GET /erp/api/audit?entityType=…&entityId=…`.

### Referential Integrity

Deletes are guarded to prevent orphaned data:

- An **Order** cannot be deleted while revisions or runs exist — archive it instead.
- A **Revision** can only be deleted while in `draft` status and only if no Order Runs reference it (409 Conflict).
- An **Order Run** can only be deleted while in `released` status.
- An **Operation / Step / Field** can be deleted only on a `draft` revision; `onDelete: Cascade` cleans up child rows.
- **Items** cannot be deleted while linked by Orders or Item Instances.
- Most user-facing FKs use `onDelete: Restrict` to force explicit cleanup; cascading deletes are limited to tightly-owned children (steps under operations, field values under records, attachments under field values, work-center-user assignments).

## State Machines

### Order Revisions

```
draft ──[approve]──> approved ──[obsolete]──> obsolete
```

- **Draft**: Editable; operations/steps/fields can be mutated; can be approved or deleted (if no runs exist).
- **Approved**: Structure is read-only; runs can be cut from it; can be marked obsolete; a diff view compares it to the prior approved rev.
- **Obsolete**: Terminal; no further actions.

### Order Runs

```
released ──[start]──> started ──[complete|close]──> closed
    │                    │
    │                    └──[cancel]──> cancelled
    │                                       ▲
    └──[cancel]───────────────────────────────┘

closed ──[reopen]──> released
cancelled ──[reopen]──> released
```

- **Released**: Not yet worked; can be updated, started, cancelled, or deleted.
- **Started**: At least one operation has begun; can be updated, cancelled, or moved to `closed`. The closing transition has two shapes: `complete` (required when the Order has an `itemKey`; accepts the `CompleteOrderRun` payload — `instanceKey`, `quantity`, and the item's template `fieldValues` — and materializes an `ItemInstance`) and `close` (used when no `itemKey` is set). Both require every `OperationRun` to be in a terminal state.
- **Closed / Cancelled**: Terminal for normal flow; a manager can `reopen` back to `released` to recover from mistakes.

### Operation Runs

```
blocked ──(predecessors complete)──> pending ──[start]──> in_progress ──[complete|skip|fail]──> completed | skipped | failed
                                           │                                      │
                                           └────────[skip|fail]───────────────────┘

completed|skipped|failed ──[reopen]──> pending
```

- **Blocked**: Waiting on one or more predecessor Operations. Auto-promotes to `pending` when the last predecessor finishes.
- **Pending**: Workable. `start` is gated by work-center assignment (admins bypass).
- **In Progress**: `complete` requires all StepRuns completed and no open labor tickets; `skip` / `fail` record a terminal outcome without those gates.
- **Completed / Skipped / Failed**: Terminal but can be `reopen`ed back to `pending` by a manager.

### Step Runs

```
completed=false ──[complete]──> completed=true ──[reopen]──> completed=false
```

Completing a step validates that every `required` field on the Step has a value; `multiSet` steps require at least one complete set.

### Labor Tickets

```
clockIn set, clockOut null ──[clock-out]──> clockIn + clockOut + cost
```

A user can have at most one open ticket against a given OperationRun. Clock-out is also triggered implicitly when the OperationRun moves to a terminal state, but completion is refused while any tickets are still open so the operator must reconcile them first.

## HATEOAS Action Mapping

`_actions` is state- and permission-dependent. Actions the current user cannot perform are still returned so the agent can see the capability surface, but with a `disabled` string explaining why (missing permission, failing gate, etc.).

| Resource        | State            | Available Actions                                                                 |
| --------------- | ---------------- | --------------------------------------------------------------------------------- |
| Order           | `active`         | update, archive, delete                                                           |
| Order           | `archived`       | update, activate, delete                                                          |
| OrderRevision   | `draft`          | update, approve, delete, + nested CRUD on operations/steps/fields/deps/refs       |
| OrderRevision   | `approved`       | create-run, diff, obsolete                                                        |
| OrderRevision   | `obsolete`       | diff                                                                              |
| OrderRun        | `released`       | update, start, cancel, delete                                                     |
| OrderRun        | `started`        | update, complete (if `itemKey`) or close (if not), cancel                         |
| OrderRun        | `closed`         | reopen                                                                            |
| OrderRun        | `cancelled`      | reopen                                                                            |
| OperationRun    | `blocked`        | assign, add-comment, start* (disabled: predecessors/work-center)                  |
| OperationRun    | `pending`        | assign, start, skip, fail, add-comment, update                                    |
| OperationRun    | `in_progress`    | update, complete*, skip, fail, clock-in/out, add-comment                          |
| OperationRun    | `completed`      | reopen, add-comment                                                               |
| OperationRun    | `skipped`        | reopen, add-comment                                                               |
| OperationRun    | `failed`         | reopen, add-comment                                                               |
| StepRun         | `completed=false`| complete, update field values, upload/delete attachments                          |
| StepRun         | `completed=true` | reopen                                                                            |
| Item            | (stateless)      | update, delete, + nested CRUD on fields and instances                             |
| ItemInstance    | (stateless)      | update, delete, update field values                                               |
| WorkCenter      | (stateless)      | update, delete, assign-user, unassign-user                                        |
| User            | (stateless)      | update, delete, grant-permission, revoke-permission, change-password              |

\* `start` and `complete` may appear as `disabled` when gates fail (blocked predecessors, work-center mismatch, open labor tickets, unfinished steps, required fields missing).

Each action includes a `schema` URL (e.g., `/erp/api/schemas/UpdateOrder`) for the request body, and many include a pre-filled `body` template for enum transitions so the agent does not need to guess the payload shape.

## API Endpoints

All paths are relative to `/erp/api`. Every list endpoint accepts `page` (default 1) and `pageSize` (default 20, hard-capped at 100) plus the filters noted inline.

### Discovery

| Method | Path                  | Description                                                    |
| ------ | --------------------- | -------------------------------------------------------------- |
| GET    | `/`                   | API root; auth-aware resource + action directory               |
| GET    | `/schemas/`           | List of registered JSON Schema names                           |
| GET    | `/schemas/:name`      | Single JSON Schema                                             |
| GET    | `/openapi.json`       | Full OpenAPI document                                          |
| GET    | `/api-reference` *    | Scalar interactive API browser (HTML; mounted outside `/api`)  |

### Auth & Users

| Method | Path                                         | Description                                 |
| ------ | -------------------------------------------- | ------------------------------------------- |
| POST   | `/auth/login`                                | Username + password → session cookie        |
| POST   | `/auth/logout`                               | Destroy current session                     |
| GET    | `/auth/me`                                   | Current user + permissions                  |
| GET    | `/users`                                     | List users (admin)                          |
| POST   | `/users`                                     | Create user (admin)                         |
| POST   | `/users/agent`                               | Create agent-user (admin, supervisor)       |
| GET    | `/users/:id`                                 | Get user                                    |
| PUT    | `/users/:id`                                 | Update user (admin)                         |
| DELETE | `/users/:id`                                 | Delete user (admin)                         |
| POST   | `/users/:id/change-password`                 | Change password (self or admin)             |
| POST   | `/users/:id/permissions/:permission`         | Grant permission (admin)                    |
| DELETE | `/users/:id/permissions/:permission`         | Revoke permission (admin)                   |
| GET    | `/user-permissions`                          | Cross-user permissions directory (admin)    |

### Admin

| Method | Path                        | Description                                                |
| ------ | --------------------------- | ---------------------------------------------------------- |
| GET    | `/admin`                    | Version, DB path, DB size, schema version (admin)          |
| GET    | `/admin/attachments`        | Paginated list of uploaded attachments (admin)             |
| GET    | `/admin/server-logs`        | Tail Pino server log (`lines`, `minLevel`) (admin)         |

### Orders, Revisions, and the Plan Tree

| Method | Path                                                                                        | Description                          |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| GET    | `/orders`                                                                                   | List (filters: `status`, `search`)   |
| POST   | `/orders`                                                                                   | Create                               |
| GET    | `/orders/:orderKey`                                                                         | Get                                  |
| PUT    | `/orders/:orderKey`                                                                         | Update                               |
| DELETE | `/orders/:orderKey`                                                                         | Delete                               |
| GET    | `/orders/:orderKey/revs`                                                                    | List revisions (filter: `status`)    |
| POST   | `/orders/:orderKey/revs`                                                                    | Create revision                      |
| GET    | `/orders/:orderKey/revs/:revNo`                                                             | Get revision                         |
| PUT    | `/orders/:orderKey/revs/:revNo`                                                             | Update (draft only)                  |
| GET    | `/orders/:orderKey/revs/:revNo/diff`                                                        | Diff vs. prior approved revision     |
| POST   | `/orders/:orderKey/revs/:revNo/approve`                                                     | `draft → approved`                   |
| POST   | `/orders/:orderKey/revs/:revNo/obsolete`                                                    | `approved → obsolete`                |
| GET    | `/orders/:orderKey/revs/:revNo/ops`                                                         | List operations                      |
| POST   | `/orders/:orderKey/revs/:revNo/ops`                                                         | Create operation                     |
| GET    | `/orders/:orderKey/revs/:revNo/ops/:seqNo`                                                  | Get operation                        |
| PUT    | `/orders/:orderKey/revs/:revNo/ops/:seqNo`                                                  | Update operation                     |
| DELETE | `/orders/:orderKey/revs/:revNo/ops/:seqNo`                                                  | Delete operation                     |
| GET    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/dependencies`                                     | List predecessors                    |
| POST   | `/orders/:orderKey/revs/:revNo/ops/:seqNo/dependencies`                                     | Add predecessor                      |
| DELETE | `/orders/:orderKey/revs/:revNo/ops/:seqNo/dependencies/:predecessorSeqNo`                   | Remove predecessor                   |
| GET    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/field-refs`                                       | List field refs                      |
| POST   | `/orders/:orderKey/revs/:revNo/ops/:seqNo/field-refs`                                       | Create field ref                     |
| DELETE | `/orders/:orderKey/revs/:revNo/ops/:seqNo/field-refs/:seqNo`                                | Delete field ref                     |
| GET    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps`                                            | List steps                           |
| POST   | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps`                                            | Create step (supports batch)         |
| GET    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo`                                 | Get step                             |
| PUT    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo`                                 | Update step                          |
| DELETE | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo`                                 | Delete step                          |
| GET    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields`                          | List step fields                     |
| POST   | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields`                          | Create field (supports batch)        |
| GET    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields/:fieldSeqNo`              | Get field                            |
| PUT    | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields/:fieldSeqNo`              | Update field                         |
| DELETE | `/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields/:fieldSeqNo`              | Delete field                         |

### Order Runs and the Execution Tree

| Method | Path                                                                                         | Description                                             |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| GET    | `/orders/:orderKey/runs`                                                                     | List (filters: `status`, `priority`, `search`)          |
| POST   | `/orders/:orderKey/runs`                                                                     | Create run from an approved revision                    |
| GET    | `/orders/:orderKey/runs/:runNo`                                                              | Get run                                                 |
| PUT    | `/orders/:orderKey/runs/:runNo`                                                              | Update run                                              |
| DELETE | `/orders/:orderKey/runs/:runNo`                                                              | Delete (released only)                                  |
| POST   | `/orders/:orderKey/runs/:runNo/start`                                                        | `released → started`                                    |
| POST   | `/orders/:orderKey/runs/:runNo/complete`                                                     | Close with item instance creation (CompleteOrderRun)    |
| POST   | `/orders/:orderKey/runs/:runNo/close`                                                        | Close without item instance                             |
| POST   | `/orders/:orderKey/runs/:runNo/cancel`                                                       | Cancel                                                  |
| POST   | `/orders/:orderKey/runs/:runNo/reopen`                                                       | Reopen closed/cancelled                                 |
| GET    | `/orders/:orderKey/runs/:runNo/ops`                                                          | List operation runs                                     |
| GET    | `/orders/:orderKey/runs/:runNo/ops/:seqNo`                                                   | Get operation run                                       |
| PUT    | `/orders/:orderKey/runs/:runNo/ops/:seqNo`                                                   | Update (e.g., `assignedToId`)                           |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/start`                                             | `pending → in_progress`                                 |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/complete`                                          | `in_progress → completed`                               |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/skip`                                              | `* → skipped`                                           |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/fail`                                              | `in_progress → failed`                                  |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/reopen`                                            | Terminal → `pending`                                    |
| GET    | `/orders/:orderKey/runs/:runNo/ops/:seqNo/comments`                                          | List comments                                           |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/comments`                                          | Add comment                                             |
| GET    | `/orders/:orderKey/runs/:runNo/ops/:seqNo/labor`                                             | List labor tickets                                      |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/labor`                                             | Clock in                                                |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/labor/:ticketId`                                   | Clock out                                               |
| GET    | `/orders/:orderKey/runs/:runNo/ops/:seqNo/steps`                                             | List step runs                                          |
| GET    | `/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo`                                  | Get step run                                            |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo/complete`                         | Mark step complete                                      |
| POST   | `/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo/reopen`                           | Reopen step                                             |
| GET    | `.../steps/:stepSeqNo/fields`                                                                | List captured field values                              |
| PUT    | `.../steps/:stepSeqNo/fields`                                                                | Batch update field values                               |
| PUT    | `.../steps/:stepSeqNo/fields/:fieldSeqNo`                                                    | Update single-value field                               |
| PUT    | `.../steps/:stepSeqNo/fields/:fieldSeqNo/values/:setIndex`                                   | Update a specific set in a multiSet field               |
| DELETE | `.../steps/:stepSeqNo/fields/:fieldSeqNo/values/:setIndex`                                   | Delete a value set                                      |
| GET    | `.../steps/:stepSeqNo/fields/:fieldSeqNo/attachments`                                        | List attachments                                        |
| POST   | `.../steps/:stepSeqNo/fields/:fieldSeqNo/attachments`                                        | Upload attachment (multipart)                           |
| DELETE | `.../steps/:stepSeqNo/fields/:fieldSeqNo/attachments/:attachmentId`                          | Detach/delete attachment                                |
| GET    | `/attachments/:publicId/download`                                                            | Download by public ID                                   |

### Items, Inventory, Work Centers

| Method | Path                                                       | Description                                       |
| ------ | ---------------------------------------------------------- | ------------------------------------------------- |
| GET    | `/items`                                                   | List items (filter: `search`)                     |
| POST   | `/items`                                                   | Create item                                       |
| GET    | `/items/:itemKey`                                          | Get item (includes field template)                |
| PUT    | `/items/:itemKey`                                          | Update item                                       |
| DELETE | `/items/:itemKey`                                          | Delete item                                       |
| GET    | `/items/:itemKey/fields`                                   | List field template                               |
| POST   | `/items/:itemKey/fields`                                   | Create field (supports batch)                     |
| PUT    | `/items/:itemKey/fields/:fieldSeqNo`                       | Update field                                      |
| DELETE | `/items/:itemKey/fields/:fieldSeqNo`                       | Delete field                                      |
| GET    | `/items/:itemKey/instances`                                | List instances                                    |
| POST   | `/items/:itemKey/instances`                                | Create instance                                   |
| GET    | `/items/:itemKey/instances/:instanceId`                    | Get instance                                      |
| PUT    | `/items/:itemKey/instances/:instanceId`                    | Update instance                                   |
| DELETE | `/items/:itemKey/instances/:instanceId`                    | Delete instance                                   |
| PUT    | `/items/:itemKey/instances/:instanceId/fields`             | Batch update field values                         |
| PUT    | `/items/:itemKey/instances/:instanceId/fields/:fieldSeqNo` | Update single field value                         |
| GET    | `/inventory`                                               | Flattened list of all item instances              |
| GET    | `/work-centers`                                            | List work centers                                 |
| POST   | `/work-centers`                                            | Create work center                                |
| GET    | `/work-centers/:key`                                       | Get work center (includes user assignments)      |
| PUT    | `/work-centers/:key`                                       | Update work center                                |
| DELETE | `/work-centers/:key`                                       | Delete work center                                |
| GET    | `/work-centers/:key/users`                                 | List assigned users                               |
| POST   | `/work-centers/:key/users`                                 | Assign user                                       |
| DELETE | `/work-centers/:key/users/:userId`                         | Unassign user                                     |

### Dispatch and Audit

| Method | Path                        | Description                                                                                     |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/dispatch`                 | Operation runs across all open orders. Filters: `status`, `priority`, `search`, `workCenter`, `canWork`, `clockedIn`, `viewAs` |
| GET    | `/dispatch/ready-to-close`  | Order runs whose operations are all terminal — candidates for close/complete                    |
| GET    | `/audit`                    | Audit log entries (filters: `entityType`, `entityId`)                                           |

### Registered JSON Schemas

The schema catalog at `/schemas/` exposes everything needed to construct request bodies:

`LoginRequest`, `CreateUser`, `CreateAgentUser`, `UpdateUser`, `GrantPermission`, `ChangePassword`,
`CreateOrder`, `UpdateOrder`,
`CreateOrderRevision`, `UpdateOrderRevision`,
`CreateOrderRun`, `UpdateOrderRun`, `CompleteOrderRun`,
`CreateOperation`, `UpdateOperation`, `CreateOperationDependency`, `CreateFieldRef`,
`UpdateOperationRun`, `CreateOperationRunComment`, `TransitionNote`,
`CreateStep`, `BatchCreateStep`, `UpdateStep`,
`CreateField`, `BatchCreateField`, `UpdateField`, `UpdateFieldValue`, `BatchUpdateFieldValues`,
`CreateItem`, `UpdateItem`, `CreateItemInstance`, `UpdateItemInstance`,
`CreateWorkCenter`, `UpdateWorkCenter`, `AssignWorkCenterUser`,
`ClockOutLaborTicket`.

## Example AI Agent Workflow

The hierarchy is deeper than the original design, but the discovery pattern is the same — follow links, fetch schemas, submit actions:

```
 1. GET  /erp/api/                         -> _links: orders, items, dispatch, …
 2. POST /erp/api/auth/login               (follow the login action if unauthenticated)
 3. POST /erp/api/orders                   { key, description, itemKey? }
        -> _links: self, revisions
 4. POST /erp/api/orders/:key/revs         { description, changeSummary? }
        -> revision in "draft", _actions: [update, approve, delete, create-operation]
 5. POST .../revs/1/ops                    { seqNo, title, workCenterKey? }
        -> operation, _actions include add-step, add-dependency, add-field-ref
 6. POST .../ops/10/steps                  { seqNo, title, instructions, multiSet }
 7. POST .../steps/10/fields               { seqNo, label, type, required }  (or batch)
 8. POST .../revs/1/approve                -> "approved", _actions: [create-run, diff, obsolete]
 9. POST /erp/api/orders/:key/runs         { revNo: 1, priority, dueAt }
        -> operation runs materialized; each carries its own _actions
10. POST .../runs/1/ops/10/start           (if predecessors complete and work-center ok)
11. PUT  .../runs/1/ops/10/steps/10/fields/1   { value }
12. POST .../runs/1/ops/10/steps/10/complete
13. POST .../runs/1/ops/10/complete
14. POST /erp/api/orders/:key/runs/1/complete  { instanceKey, quantity, fieldValues }
        (when Order has itemKey; creates an ItemInstance)
```

At no point did the agent need to know URL patterns, valid status transitions, or which fields are required. Everything was discovered from server responses. The agent only fetched the specific schemas it needed, not the full OpenAPI spec.

## Web UI

The React client lives under `apps/erp/client/src/pages/` and is organized by resource:

- **Login** — Auth form with supervisor-auth fall-through when enabled.
- **Orders** — Order list / detail / create, with nested revision editor (`revs/`): operation index + detail with sidebar navigation, step list, dependency editor, field-ref editor, and a revision-diff view.
- **Runs** — Order run list / detail, operation-run index / detail with sidebar, step-run list, completion dialog (collects Item Instance fields), comment list, labor-ticket clock-in/out.
- **Items** — Catalog list + detail, field template editor, instance list + detail with field-value editor.
- **Inventory** — Flattened view of every Item Instance across items.
- **Dispatch** — `canWork`/`clockedIn` filtered table of operation runs, plus a Ready-to-Close list for managers.
- **Work Centers** — List + detail with user-assignment editor.
- **Users / Admin** — User list + detail with permission management; admin page showing version, DB info, attachments, and server log tail.

All pages render action buttons from the `_actions` array returned by the API, so the UI and API always agree on what's possible and disabled actions carry their reason as a tooltip/banner.

## Testing

- **Unit (Vitest, `server/src/tests/`)**: `enum-sync` checks that Prisma enums and shared Zod enums stay in lockstep; `openapi-spec` checks the generated OpenAPI document; `pageSize-cap` checks pagination defaults and caps.
- **E2E (Playwright, `server/e2e/`)**: auth helpers plus API and UI suites covering happy paths for Orders, Revisions, Operations, Steps, Fields, Order Runs, Operation Runs, Step Runs, Items, Item Instances, Dispatch, Work Centers, Labor Tickets, and role-based permission enforcement.
- Tests run against a fresh SQLite database seeded by `global-setup.ts`.

## Future Considerations

- Order definitions as templates for creating orders
- Batch operations for managing multiple orders / runs
- Webhook/event notifications for status changes
- Richer agent-specific API key scopes and per-agent audit trails
- Cost tracking integration with NAISYS spend limits

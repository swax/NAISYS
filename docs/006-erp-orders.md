# NAISYS ERP - Order Management

**Status: In Progress**

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
- **`_actions`** - Available operations with HTTP method, URL, human-readable title, schema reference, and optionally a pre-filled request body template

An agent workflow becomes: fetch resource, read `_actions`, pick the appropriate one, fetch its schema if needed, execute it. No URL construction, no memorizing endpoint paths.

### Schema Discovery

API schemas are discoverable through three complementary mechanisms:

1. **Per-schema endpoint** at `/erp/api/schemas/:name` - Returns a single JSON Schema for a named schema (e.g., `CreateOrder`). This is what HATEOAS `_actions` and `_links` point to, so an agent can fetch only the schema it needs for a specific action without downloading the entire API spec.
2. **Schema catalog** at `/erp/api/schemas/` - Lists all available schema names, useful for agent discovery.
3. **OpenAPI spec** at `/erp/api/openapi.json` - Full machine-readable API contract auto-generated from Zod schemas, with `components/schemas` populated. Useful for tools like Scalar UI or for caching the complete API surface.
4. **Interactive API reference** at `/erp/api-reference` - Scalar UI for human exploration and testing.

The per-schema endpoint is the primary mechanism for agents. When an agent sees an action like `{ "rel": "update", "schema": "/erp/api/schemas/UpdateOrder" }`, it fetches that URL to get the exact JSON Schema for the request body — field names, types, constraints, enums — without the overhead of the full OpenAPI spec.

## Architecture

### Package Structure

```
apps/erp/
  server/          # Fastify backend, Prisma ORM, SQLite
  client/          # React 19 + Vite frontend
  shared/          # TypeScript types shared across client and server
  e2e/             # Playwright API and UI tests
```

The ERP is built as a **Fastify plugin** (`erpPlugin`) that can be:

- **Standalone** - Runs on port 3201 for independent development
- **Embedded** - Mounted into the NAISYS supervisor application under `/erp/`

### Tech Stack

| Layer    | Technology                        |
| -------- | --------------------------------- |
| API      | Fastify with ZodTypeProvider      |
| Database | SQLite via Prisma (BetterSqlite3) |
| Schemas  | Zod (shared validation + OpenAPI) |
| API Docs | @fastify/swagger + Scalar UI      |
| Frontend | React 19 + Vite + React Router v7 |
| Testing  | Playwright (API + E2E)            |

### API Root Discovery

```
GET /erp/api/

{
  "name": "NAISYS ERP API",
  "version": "1.0.0",
  "description": "AI-first ERP system",
  "_links": [
    { "rel": "self", "href": "/erp/api/" },
    { "rel": "orders", "href": "/erp/api/orders" },
    { "rel": "schemas", "href": "/erp/api/schemas/" },
    { "rel": "api-reference", "href": "/erp/api-reference" }
  ],
  "_actions": [
    { "rel": "create-order", "href": "/erp/api/orders", "method": "POST",
      "schema": "/erp/api/schemas/CreateOrder" }
  ]
}
```

From this single response, an agent knows: what the API is, where to find the full spec, what resources exist, and how to create new ones. Order runs are nested under orders and discovered via order links.

## Data Model

The order system uses a three-tier hierarchy: Orders define what to build, Revisions capture the approval workflow, and Order Runs track the actual work.

### Orders

The top-level entity representing a type of work to be done.

| Field       | Type     | Notes                        |
| ----------- | -------- | ---------------------------- |
| id          | int (PK) | Auto-increment               |
| key         | string   | Unique slug (`^[a-z0-9-]+$`) |
| name        | string   | Display name                 |
| description | string?  | Optional details             |
| status      | enum     | `active` / `archived`        |
| created_by  | string   | Audit: who created           |
| created_at  | datetime | Audit: when created          |
| updated_by  | string   | Audit: who last modified     |
| updated_at  | datetime | Audit: when last modified    |

### Order Revisions

Versioned snapshots of an order that go through an approval workflow.

| Field          | Type      | Notes                                  |
| -------------- | --------- | -------------------------------------- |
| id             | int (PK)  | Auto-increment                         |
| order_id       | int (FK)  | Parent order                           |
| rev_no         | int       | Auto-incremented per order             |
| status         | enum      | `draft` / `approved` / `obsolete`      |
| notes          | string?   | Revision details                       |
| change_summary | string?   | What changed from previous revision    |
| created_at     | datetime  | When created                           |
| approved_at    | datetime? | When approved (null if draft/obsolete) |

**Unique constraint**: `(order_id, rev_no)` - revision numbers are sequential per order.

### Order Runs

Concrete work items created from an approved revision. Track the actual execution of planned work. Nested under orders as "runs".

| Field              | Type            | Notes                                           |
| ------------------ | --------------- | ----------------------------------------------- |
| id                 | int (PK)        | Auto-increment                                  |
| order_no           | int             | Auto-incremented per order                      |
| order_id           | int (FK)        | Source order                                    |
| order_rev_id       | int (FK)        | Source revision                                 |
| status             | enum            | `released` / `started` / `closed` / `cancelled` |
| priority           | enum            | `low` / `medium` / `high` / `critical`          |
| scheduled_start_at | datetime?       | When work should begin                          |
| due_at             | datetime?       | Deadline                                        |
| assigned_to        | string?         | Agent or person responsible                     |
| notes              | string?         | Additional context                              |
| created_by/at      | string/datetime | Audit trail                                     |
| updated_by/at      | string/datetime | Audit trail                                     |

**Unique constraint**: `(order_id, order_no)` - order numbers are sequential per order.

### Referential Integrity

Deletes are guarded to prevent orphaned data:

- An **Order** cannot be deleted if it has any revisions (409 Conflict). Archive it instead.
- A **Revision** can only be deleted while in `draft` status, and only if it has no order runs referencing it (409 Conflict).
- An **Order Run** can only be deleted while in `released` status.

## State Machines

### Order Revisions

```
draft ──[approve]──> approved ──[obsolete]──> obsolete
```

- **Draft**: Can be updated, approved, or deleted
- **Approved**: Read-only; can be marked obsolete; can be used to create Order Runs (runs)
- **Obsolete**: Terminal state, no further actions

### Order Runs

```
released ──[start]──> started ──[close]──> closed
    │                    │
    └──[cancel]──> cancelled <──[cancel]──┘
```

- **Released**: Can be updated, started, cancelled, or deleted
- **Started**: Can be updated, closed, or cancelled
- **Closed**: Terminal state, no actions
- **Cancelled**: Terminal state, no actions

## HATEOAS Action Mapping

The `_actions` array in each response is **state-dependent**. The server evaluates the current resource state and only includes actions that are valid right now.

| Resource | State     | Available Actions             |
| -------- | --------- | ----------------------------- |
| Order    | active    | update, delete, archive       |
| Order    | archived  | update, delete, activate      |
| Revision | draft     | update, approve, delete       |
| Revision | approved  | cut-order, obsolete           |
| Revision | obsolete  | (none)                        |
| OrderRun | released  | update, start, cancel, delete |
| OrderRun | started   | update, close, cancel         |
| OrderRun | closed    | (none)                        |
| OrderRun | cancelled | (none)                        |

Each action includes a `schema` URL (e.g., `/erp/api/schemas/UpdateOrder`) that the agent can fetch to get the JSON Schema for the request body. Some actions include a `body` template with required fields pre-filled (e.g., a status transition action that requires `{ status: "archived" }`).

## API Endpoints

### Orders

| Method | Path                  | Description                  |
| ------ | --------------------- | ---------------------------- |
| GET    | `/erp/api/orders`     | List (paginated, filterable) |
| POST   | `/erp/api/orders`     | Create                       |
| GET    | `/erp/api/orders/:id` | Get single                   |
| PUT    | `/erp/api/orders/:id` | Update                       |
| DELETE | `/erp/api/orders/:id` | Delete (if no revisions)     |

### Order Revisions

| Method | Path                                    | Description          |
| ------ | --------------------------------------- | -------------------- |
| GET    | `/erp/api/orders/:orderKey/revs`        | List                 |
| POST   | `/erp/api/orders/:orderKey/revs`        | Create               |
| GET    | `/erp/api/orders/:orderKey/revs/:revNo` | Get single           |
| PUT    | `/erp/api/orders/:orderKey/revs/:revNo` | Update (draft only)  |
| DELETE | `/erp/api/orders/:orderKey/revs/:revNo` | Delete (draft only)  |
| POST   | `.../revs/:revNo/approve`               | Draft -> Approved    |
| POST   | `.../revs/:revNo/obsolete`              | Approved -> Obsolete |

### Order Runs

| Method | Path                                        | Description               |
| ------ | ------------------------------------------- | ------------------------- |
| GET    | `/erp/api/orders/:orderKey/runs`            | List (paginated)          |
| POST   | `/erp/api/orders/:orderKey/runs`            | Create                    |
| GET    | `/erp/api/orders/:orderKey/runs/:id`        | Get single                |
| PUT    | `/erp/api/orders/:orderKey/runs/:id`        | Update (released/started) |
| DELETE | `/erp/api/orders/:orderKey/runs/:id`        | Delete (released only)    |
| POST   | `/erp/api/orders/:orderKey/runs/:id/start`  | Released -> Started       |
| POST   | `/erp/api/orders/:orderKey/runs/:id/close`  | Started -> Closed         |
| POST   | `/erp/api/orders/:orderKey/runs/:id/cancel` | -> Cancelled              |

### Schemas

| Method | Path                           | Description                     |
| ------ | ------------------------------ | ------------------------------- |
| GET    | `/erp/api/schemas/`            | List all available schema names |
| GET    | `/erp/api/schemas/:schemaName` | Get a single JSON Schema        |

Available schemas: `CreateOrder`, `UpdateOrder`, `CreateOrderRevision`, `UpdateOrderRevision`, `CreateOrderRun`, `UpdateOrderRun`.

### Query Parameters

All list endpoints support `page` (default 1) and `pageSize` (default 20, max 100). Additional filters:

- Orders: `status` (active/archived), `search` (name/key)
- Revisions: `status` (draft/approved/obsolete)
- Order Runs: `status`, `priority`, `search`

## Example AI Agent Workflow

This illustrates how an agent with zero prior knowledge can operate the system:

```
1. GET /erp/api/
   -> Learn about available resources, get links and actions

2. Read the "create-order" action from _actions
   -> { href: "/erp/api/orders", method: "POST",
        schema: "/erp/api/schemas/CreateOrder" }

3. GET /erp/api/schemas/CreateOrder
   -> JSON Schema with required fields, types, constraints
      (lightweight ~200 bytes, not the full OpenAPI spec)

4. POST /erp/api/orders { key: "widget-assembly", name: "Widget Assembly", ... }
   -> Response includes _links (self, revisions) and _actions (update, delete, archive)

5. Follow "revisions" link -> GET /erp/api/orders/widget-assembly/revs
   -> Empty list, use create action

6. POST /erp/api/orders/widget-assembly/revs { notes: "Initial plan", ... }
   -> Response: revision in "draft" status, _actions: [update, approve, delete]

7. POST .../revs/1/approve  (from _actions)
   -> Response: "approved" status, _actions: [cut-order, obsolete]

8. Follow "cut-order" action from the approved revision
   -> { href: "/erp/api/orders/widget-assembly/runs", method: "POST",
        schema: "/erp/api/schemas/CreateOrderRun" }

9. GET /erp/api/schemas/CreateOrderRun
   -> Learn required fields: orderRevId, etc.

10. POST /erp/api/orders/widget-assembly/runs { orderRevId: 1, priority: "high", ... }
    -> Response: order run in "released" status, _actions: [update, start, cancel, delete]

11. POST /erp/api/orders/widget-assembly/runs/1/start  (from _actions)
    -> Response: "started" status, _actions: [update, close, cancel]

12. POST /erp/api/orders/widget-assembly/runs/1/close  (from _actions)
    -> Response: "closed" status, _actions: []  (terminal state)
```

At no point did the agent need to know URL patterns, valid status transitions, or which fields are required. Everything was discovered from server responses. The agent only fetched the specific schemas it needed, not the full OpenAPI spec.

## Web UI

The React frontend mirrors the API's capabilities and is structured around the same resource hierarchy:

- **Order List** - Paginated table with search and status filters
- **Order Detail** - View/edit with embedded revision management
- **Order Create** - Form with key validation
- **Runs List** - Paginated table with status and priority filters, scoped to an order
- **Run Detail** - View/edit with state-dependent action buttons
- **Run Create** - Form with revision selection (order derived from URL)

The UI conditionally renders action buttons based on the `_actions` array from the API, ensuring the UI and API always agree on what's possible.

## Testing

Playwright E2E tests cover the API happy paths:

- **Orders**: CRUD operations, status transitions
- **Order Revisions**: Full lifecycle (draft -> approved -> obsolete), auto-incrementing rev_no, status filtering, referential integrity (409 on delete with children)
- **Order Runs**: Full lifecycle (released -> started -> closed, released -> cancelled), priority filtering, state transition validation (409 on invalid transitions), referential integrity guards

## Future Considerations

- Order definitions as templates for creating orders
- Batch operations for managing multiple orders
- Webhook/event notifications for status changes
- Agent-specific API keys and audit trails per agent identity
- Cost tracking integration with NAISYS spend limits

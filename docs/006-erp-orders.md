# NAISYS ERP - Order Management

**Status: In Progress**

## Overview

The NAISYS ERP is an AI-first enterprise resource planning system designed to be operated primarily by AI agents and monitored by humans. The core design principle is that an AI agent should be able to start at a single root URL (`GET /api/erp/`) and fully discover, understand, and operate the entire system through HATEOAS (Hypermedia as the Engine of Application State) without any hardcoded knowledge of endpoints or schemas.

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

API schemas are discoverable through two complementary mechanisms:

1. **OpenAPI spec** at `/api/erp/openapi.json` - Full machine-readable API contract auto-generated from Zod schemas
2. **Per-resource schema links** - Each response's `_links` includes a `schema` rel pointing to the relevant `#/components/schemas/...` definition
3. **Interactive API reference** at `/erp/api-reference` - Scalar UI for human exploration and testing

An agent can fetch the OpenAPI spec once, cache it, and use the schema references from HATEOAS responses to look up validation rules, required fields, and enum values for any operation it wants to perform.

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

- **Standalone** - Runs on port 3002 for independent development
- **Embedded** - Mounted into the NAISYS supervisor application under `/erp/`

### Tech Stack

| Layer     | Technology                         |
| --------- | ---------------------------------- |
| API       | Fastify with ZodTypeProvider       |
| Database  | SQLite via Prisma (BetterSqlite3)  |
| Schemas   | Zod (shared validation + OpenAPI)  |
| API Docs  | @fastify/swagger + Scalar UI      |
| Frontend  | React 19 + Vite + React Router v7 |
| Testing   | Playwright (API + E2E)            |

### API Root Discovery

```
GET /api/erp/

{
  "name": "NAISYS ERP API",
  "version": "1.0.0",
  "description": "AI-first ERP system",
  "_links": [
    { "rel": "self", "href": "/api/erp/" },
    { "rel": "openapi-spec", "href": "/api/erp/openapi.json" },
    { "rel": "api-reference", "href": "/erp/api-reference" },
    { "rel": "planning-orders", "href": "/api/erp/planning/orders" },
    { "rel": "execution-orders", "href": "/api/erp/execution/orders" }
  ],
  "_actions": [
    { "rel": "create-planning-order", "href": "/api/erp/planning/orders", "method": "POST", ... },
    { "rel": "create-execution-order", "href": "/api/erp/execution/orders", "method": "POST", ... }
  ]
}
```

From this single response, an agent knows: what the API is, where to find the full spec, what resources exist, and how to create new ones.

## Data Model

The order system uses a three-tier hierarchy: Planning Orders define what to build, Revisions capture the approval workflow, and Execution Orders track the actual work.

### Planning Orders

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

### Planning Order Revisions

Versioned snapshots of a planning order that go through an approval workflow.

| Field          | Type     | Notes                                  |
| -------------- | -------- | -------------------------------------- |
| id             | int (PK) | Auto-increment                         |
| plan_order_id  | int (FK) | Parent planning order                  |
| rev_no         | int      | Auto-incremented per order             |
| status         | enum     | `draft` / `approved` / `obsolete`      |
| notes          | string?  | Revision details                       |
| change_summary | string?  | What changed from previous revision    |
| created_at     | datetime | When created                           |
| approved_at    | datetime?| When approved (null if draft/obsolete) |

**Unique constraint**: `(plan_order_id, rev_no)` - revision numbers are sequential per order.

### Execution Orders

Concrete work items created from an approved revision. Track the actual execution of planned work.

| Field              | Type     | Notes                                        |
| ------------------ | -------- | -------------------------------------------- |
| id                 | int (PK) | Auto-increment                               |
| order_no           | int      | Auto-incremented per planning order          |
| plan_order_id      | int (FK) | Source planning order                        |
| plan_order_rev_id  | int (FK) | Source revision                              |
| status             | enum     | `released` / `started` / `closed` / `cancelled` |
| priority           | enum     | `low` / `medium` / `high` / `critical`       |
| scheduled_start_at | datetime?| When work should begin                       |
| due_at             | datetime?| Deadline                                     |
| assigned_to        | string?  | Agent or person responsible                  |
| notes              | string?  | Additional context                           |
| created_by/at      | string/datetime | Audit trail                           |
| updated_by/at      | string/datetime | Audit trail                           |

**Unique constraint**: `(plan_order_id, order_no)` - order numbers are sequential per planning order.

### Cascading Deletes

Deleting a Planning Order cascades to all its Revisions and Execution Orders. This prevents orphaned data and simplifies cleanup in multi-agent scenarios.

## State Machines

### Planning Order Revisions

```
draft ──[approve]──> approved ──[obsolete]──> obsolete
```

- **Draft**: Can be updated, approved, or deleted
- **Approved**: Read-only; can be marked obsolete; can be used to create Execution Orders
- **Obsolete**: Terminal state, no further actions

### Execution Orders

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

| Resource  | State    | Available Actions                |
| --------- | -------- | -------------------------------- |
| PlanOrder | active   | update, delete, archive          |
| PlanOrder | archived | update, delete, activate         |
| Revision  | draft    | update, approve, delete          |
| Revision  | approved | obsolete                         |
| Revision  | obsolete | (none)                           |
| ExecOrder | released | update, start, cancel, delete    |
| ExecOrder | started  | update, close, cancel            |
| ExecOrder | closed   | (none)                           |
| ExecOrder | cancelled| (none)                           |

Each action includes a `schema` reference so the agent can look up what fields to send. Some actions include a `body` template with required fields pre-filled (e.g., a status transition action that requires `{ status: "started" }`).

## API Endpoints

### Planning Orders

| Method | Path                                              | Description                    |
| ------ | ------------------------------------------------- | ------------------------------ |
| GET    | `/api/erp/planning/orders`                        | List (paginated, filterable)   |
| POST   | `/api/erp/planning/orders`                        | Create                         |
| GET    | `/api/erp/planning/orders/:id`                    | Get single                     |
| PUT    | `/api/erp/planning/orders/:id`                    | Update                         |
| DELETE | `/api/erp/planning/orders/:id`                    | Delete (cascades)              |

### Planning Order Revisions

| Method | Path                                                           | Description         |
| ------ | -------------------------------------------------------------- | ------------------- |
| GET    | `/api/erp/planning/orders/:orderId/revisions`                  | List                |
| POST   | `/api/erp/planning/orders/:orderId/revisions`                  | Create              |
| GET    | `/api/erp/planning/orders/:orderId/revisions/:revisionId`      | Get single          |
| PUT    | `/api/erp/planning/orders/:orderId/revisions/:revisionId`      | Update (draft only) |
| DELETE | `/api/erp/planning/orders/:orderId/revisions/:revisionId`      | Delete (draft only) |
| POST   | `.../revisions/:revisionId/approve`                            | Draft -> Approved   |
| POST   | `.../revisions/:revisionId/obsolete`                           | Approved -> Obsolete|

### Execution Orders

| Method | Path                                      | Description              |
| ------ | ----------------------------------------- | ------------------------ |
| GET    | `/api/erp/execution/orders`               | List (paginated)         |
| POST   | `/api/erp/execution/orders`               | Create                   |
| GET    | `/api/erp/execution/orders/:id`           | Get single               |
| PUT    | `/api/erp/execution/orders/:id`           | Update (released/started)|
| DELETE | `/api/erp/execution/orders/:id`           | Delete (released only)   |
| POST   | `/api/erp/execution/orders/:id/start`     | Released -> Started      |
| POST   | `/api/erp/execution/orders/:id/close`     | Started -> Closed        |
| POST   | `/api/erp/execution/orders/:id/cancel`    | -> Cancelled             |

### Query Parameters

All list endpoints support `page` (default 1) and `pageSize` (default 20, max 100). Additional filters:

- Planning Orders: `status` (active/archived), `search` (name/key)
- Revisions: `status` (draft/approved/obsolete)
- Execution Orders: `status`, `priority`, `search`

## Example AI Agent Workflow

This illustrates how an agent with zero prior knowledge can operate the system:

```
1. GET /api/erp/
   -> Learn about available resources, get links

2. GET /api/erp/openapi.json
   -> Cache the full API spec for schema lookups

3. Follow "planning-orders" link -> GET /api/erp/planning/orders
   -> See existing orders, or use "create-planning-order" action from root

4. POST /api/erp/planning/orders { key: "widget-assembly", name: "Widget Assembly", ... }
   -> Response includes _links (self, revisions) and _actions (update, delete, archive)

5. Follow "revisions" link -> GET /api/erp/planning/orders/1/revisions
   -> Empty list, use create action

6. POST /api/erp/planning/orders/1/revisions { notes: "Initial plan", ... }
   -> Response: revision in "draft" status, _actions: [update, approve, delete]

7. POST .../revisions/1/approve  (from _actions)
   -> Response: "approved" status, _actions: [obsolete]

8. POST /api/erp/execution/orders { planOrderId: 1, planOrderRevId: 1, priority: "high", ... }
   -> Response: execution order in "released" status, _actions: [update, start, cancel, delete]

9. POST /api/erp/execution/orders/1/start  (from _actions)
   -> Response: "started" status, _actions: [update, close, cancel]

10. POST /api/erp/execution/orders/1/close  (from _actions)
    -> Response: "closed" status, _actions: []  (terminal state)
```

At no point did the agent need to know URL patterns, valid status transitions, or which fields are required. Everything was discovered from server responses.

## Web UI

The React frontend mirrors the API's capabilities and is structured around the same resource hierarchy:

- **Planning Order List** - Paginated table with search and status filters
- **Planning Order Detail** - View/edit with embedded revision management
- **Planning Order Create** - Form with key validation
- **Execution Order List** - Paginated table with status and priority filters
- **Execution Order Detail** - View/edit with state-dependent action buttons
- **Execution Order Create** - Form with planning order/revision selection

The UI conditionally renders action buttons based on the `_actions` array from the API, ensuring the UI and API always agree on what's possible.

## Testing

Playwright E2E tests cover the API happy paths:

- **Planning Orders**: CRUD operations, status transitions
- **Planning Order Revisions**: Full lifecycle (draft -> approved -> obsolete), auto-incrementing rev_no, status filtering, cascading deletes
- **Execution Orders**: Full lifecycle (released -> started -> closed, released -> cancelled), priority filtering, state transition validation (409 on invalid transitions)

## Future Considerations

- Order definitions as templates for creating planning orders
- Batch operations for managing multiple orders
- Webhook/event notifications for status changes
- Agent-specific API keys and audit trails per agent identity
- Cost tracking integration with NAISYS spend limits

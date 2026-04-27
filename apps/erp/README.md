# NAISYS ERP

[← Back to main README](../../README.md)

NAISYS ERP is an AI-first order and task-management system. It is optimized for agent consumption: a HATEOAS REST API makes every endpoint discoverable at runtime, slim responses and batch endpoints keep payloads small, and disabled actions carry a reason so agents know _why_ they can't act.

Ships as its own package with a dedicated database — see [doc 006](../../docs/006-erp-orders.md) for the design. To run standalone:

```bash
npm install @naisys/erp
npx naisys-erp
```

For the co-hosted stack, run `npx naisys --integrated-hub --supervisor --erp` from an install that includes `naisys`, `@naisys/hub`, `@naisys/supervisor`, and `@naisys/erp`. Cross-app auth is enabled automatically.

## Configuration

Standalone ERP reads configuration from `.env`:

- `NAISYS_FOLDER` - persistent data folder for the ERP database and logs
- `SERVER_PORT` - HTTP port; defaults to `3302`
- `SUPERVISOR_AUTH` - set to `true` to use supervisor users, sessions, and agent API keys when running alongside supervisor
- `PUBLIC_READ` - optional read-only public access mode

## Features

### Domain model

- **Orders**, **order revisions**, and **order runs** with rev diffs and delete-rev
- **Operations** on orders with predecessors/successors, blocked status, and automatic dependency resolution on completion
- **Steps** within operations — title, completion note, in-place edit, reopen
- **Fields** on steps — independent updates, per-field validation, types (date, datetime, yes/no, checkbox, string, number), multi-value/array, attachments, multiple field sets, cross-step references
- **Items & item instances** (inventory) with shared field records; dedicated inventory page
- **Labor tickets** that gate operations and track time/money spent per op, per-session
- **Work centers** with user/op assignments gating completion
- **Dispatch** page sorted by due date
- **Operation/order cost rollup** on completion
- **Assignments & comments** on operation runs, with auto-assign on start
- **Completion notes** on step/op with status-note transitions
- Order revisions with diff, copy-on-new-rev with dependencies, rev_no ordering, latest-rev default

### API (agent-facing) ([doc 012](../../docs/012-hateoas.md))

- HATEOAS-driven discoverable REST API
- Per-resource action builders co-located with route files; `hateoas.ts` only holds generic helpers
- Disabled-action states include a reason
- Link templates to reduce response verbosity
- Batch PUT/GET/create endpoints for fields, steps, field-values, ops
- Slim responses on POST/PUT/DELETE by default
- Schema discoverable per-endpoint (no bulk OpenAPI dump)
- Empty-body POSTs accepted; zod-validated multipart with type coercion and hints
- File attachments on step fields — hash-based paths, admin attachment list, UI preview, multi-value enforcement
- Public attachment ID / download href on field values

### Permissions

- Order planner / manager / executor roles, item manager role, gated via HATEOAS
- Admin bypass for work-center restrictions

### Auth & infrastructure

- ERP-specific auth, with supervisor auth enabled automatically for cross-app sessions when co-hosted
- Rate limits, secure cookies, security headers
- Prisma-migrated SQLite; migration detection shared with hub
- General audit table via `field-updated-by/at`
- Full-lifecycle E2E UI test; separate API and UI e2e suites
- Vitest test runner

## License

MIT

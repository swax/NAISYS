# @naisys/erp-shared

[← Back to ERP](../README.md) | [← Back to main README](../../../README.md)

Shared types and Zod validation schemas used by both the ERP server and client. Internal to the monorepo (not published to npm).

Keeping the request/response shapes here lets the React client and Fastify server compile-check against the same contracts — when a route's input or output changes, both sides break together rather than drifting apart.

## What's inside

- **`api-types.ts`** — common request/response envelope types
- **`admin-types.ts`** — admin UI types (system info, attachment list, etc.)
- **`audit-types.ts`** — `field-updated-by/at` audit metadata
- **`error-types.ts`** — standard error envelope
- **`hateoas-types.ts`** — link/action shapes used by ERP route responses
- **`mutation-types.ts`** — slim response shapes for POST/PUT/DELETE
- **`pagination-types.ts`** — forward + backward pagination link shapes
- **`revision-diff-types.ts`** — order-revision diff payloads
- **`items/`** — items, item instances, inventory
- **`operations/`** — operations, operation runs, dependencies, comments
- **`orders/`** — orders, order revisions, order runs
- **`production/`** — fields, field refs, work centers
- **`steps/`** — steps, step runs, labor tickets
- **`users/`** — auth + user types

## Usage

```typescript
import { type OrderResponse, orderCreateSchema } from "@naisys/erp-shared";
```

See [doc 006 — ERP Orders](../../../docs/006-erp-orders.md) for the domain model and [doc 012 — HATEOAS](../../../docs/012-hateoas.md) for the API-design conventions these types follow.

## License

MIT

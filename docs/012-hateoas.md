# HATEOAS: AI-First REST API Design

The NAISYS Supervisor and ERP APIs are built around a HATEOAS-style envelope
designed specifically for AI agents as first-class clients. Instead of
front-loading every tool definition into a static prompt (as MCP and
traditional tool-calling frameworks do), the API exposes a single entry point
from which the agent discovers exactly — and only — what it needs for the task
at hand. The web UI is a thin client over the same surface.

This doc captures the design principles, the shape of the envelope, and the
patterns that keep it efficient to consume.

## Why not MCP-style tool catalogs?

MCP (and most tool-use frameworks) assume the caller loads the full tool
catalog up front, then chooses from it. For a small API that works. For a
system with hundreds of endpoints across planning, dispatch, execution,
attachments, users, admin, etc., it wastes tokens on every turn, and every
tool description has to anticipate every possible caller state.

A REST-with-HATEOAS API inverts that:

- **The entry point is tiny.** `GET /erp/api/` returns ~10 links.
- **Navigation is context-sensitive.** An agent that needs to process work
  follows `dispatch` → a specific order run → its operations; it never loads
  the Admin, Users, or Inventory branches.
- **Current state is explicit in the response.** Each resource carries
  `_actions` describing what can be done _to this specific resource right
  now_, including why some actions are disabled. The agent doesn't have to
  re-derive the state machine.
- **Schemas are fetched only when needed.** An action declares
  `schema: "/erp/api/schemas/UpdateOrder"`; the agent fetches that once
  before invoking the action, not at session start.

The design goal throughout is: minimise the context an agent needs to load,
maximise the information density of each response, and never force the agent
to guess.

## The envelope

Every non-trivial response carries some subset of four members:

| Member             | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `_links`           | Navigation: `self`, `collection`, `parent`, pagination, related        |
| `_actions`         | Concrete things this caller can try on this resource (POST/PUT/DELETE) |
| `_linkTemplates`   | URL patterns for items in a list (e.g. `/orders/{key}`)                |
| `_actionTemplates` | Action patterns that apply to every item in a list or sub-collection   |

Schemas and types live in `packages/common/src/hateoas-types.ts` —
`HateoasLink`, `HateoasAction`, `HateoasLinkTemplate`, `HateoasActionTemplate`
— and are shared by both supervisor and ERP.

### An action

```json
{
  "rel": "start",
  "href": "/supervisor/api/agents/researcher/start",
  "method": "POST",
  "title": "Start Agent",
  "schema": "/supervisor/api/schemas/StartAgent",
  "body": { "task": "" },
  "disabled": true,
  "disabledReason": "Agent is already running"
}
```

Six ideas are encoded in that one object:

1. **`rel`** is a stable symbolic name the client uses (`hasAction(actions, "start")`), not the URL. URLs change; rels don't.
2. **`href` + `method`** are a ready-to-invoke request.
3. **`schema`** is a URL to fetch the full JSON Schema if the client needs
   parameter details.
4. **`body`** is an inline example/stub — enough for the client to see the
   shape without a schema round-trip in the common case.
5. **`disabled: true`** means "you know this exists, but you can't invoke it
   right now."
6. **`disabledReason`** explains why, so the agent has recourse (or at least
   a hint about what to change).

A link is the same minus `method`, `body`, and the disabled fields.

## Minimising response size

AI context is expensive. Every response is optimised so it carries only what
the caller needs for the next step.

### Slim list rows, rich detail resources

List endpoints return compact rows — typically just identifiers, a status,
and a short label. `_actions` **do not** appear on individual list items;
they appear once on the detail resource after the caller navigates in. See
`formatListUser()` vs `formatUser()` in `routes/users.ts`, and
`formatListOrder()` vs `formatOrder()` in `routes/orders.ts`.

The exception is the collection itself, which carries `_actions.create` (or
similar) once at the top level.

### `_linkTemplates` and `_actionTemplates` instead of per-item repetition

When an action applies uniformly to every item in a list, emitting it on each
item would balloon the response. Templates factor the pattern out to the
parent:

```json
{
  "items": [ { "id": 1, "key": "admin", ... }, { "id": 2, "key": "alice", ... } ],
  "_linkTemplates": [
    { "rel": "item", "hrefTemplate": "/supervisor/api/users/{username}" }
  ]
}
```

For a step run with many fields, `_actionTemplates` describes the update
pattern once:

```json
{
  "_actionTemplates": [
    {
      "rel": "updateField",
      "hrefTemplate": "/.../steps/{stepSeqNo}/fields/{fieldSeqNo}",
      "method": "PUT",
      "schema": "/erp/api/schemas/UpdateFieldValue",
      "body": { "value": "" }
    }
  ]
}
```

Compared to a full `_actions` array on every field, this saves hundreds of
tokens per response once a step has half a dozen fields.

### `Prefer: return=representation`

Mutation endpoints (POST/PUT/DELETE) return a **slim** body by default —
typically `{ success, message, id }` plus minimal `_links` / `_actions` —
because an agent that just successfully issued a command usually doesn't need
the full resource echoed back.

UI clients that _do_ want the full resource (to refresh their view) send
`Prefer: return=representation` (RFC 7240). The server switches to the full
formatter and overrides Fastify's schema-driven serialiser so every field
makes it through. See `mutationResult()` in `apps/erp/server/src/route-helpers.ts`.

### Inline `body` hints on actions

Actions carry a `body` stub that matches the schema:

```json
{
  "rel": "create",
  "href": "...",
  "method": "POST",
  "body": { "username": "" },
  "schema": "/supervisor/api/schemas/CreateUser"
}
```

For simple requests the agent never fetches the schema at all — the stub is
enough to fill out. The schema is there as a fallback for unfamiliar or
complex bodies.

## Multipart / file responses

Some actions can't be expressed as JSON bodies — file uploads, for example.
Those carry an `alternateEncoding` field instead of `body`:

```json
{
  "rel": "uploadAttachment",
  "hrefTemplate": ".../fields/{fieldSeqNo}/attachments",
  "method": "POST",
  "title": "Upload Attachment",
  "alternateEncoding": {
    "contentType": "multipart/form-data",
    "description": "Upload file as multipart/form-data with field 'file'",
    "fileFields": ["file"]
  }
}
```

`fileFields` lists the field names that should be attached as file parts;
`contentType` tells the client which encoding to use; `description` is a
plain-English hint. This lets an AI client handle uploads without any
special-cased knowledge — the usual "read this action and do what it says"
rule still works.

Downloads are ordinary GET links; the server returns the file stream with
`content-type` and `content-disposition` headers set from the stored
metadata. See `routes/step-field-attachments.ts`.

## Action gating: disabled-with-reason, not hidden

The default policy is to **emit every action** the resource logically
supports, even when the current caller can't invoke it right now, and mark
it with `disabled: true` + a human-readable `disabledReason`.

```json
{
  "rel": "archive",
  "href": "/.../agents/researcher/archive",
  "method": "POST",
  "title": "Archive Agent",
  "disabled": true,
  "disabledReason": "Stop the agent before archiving"
}
```

Reasons the default favours disabled-with-reason over hiding:

- **Discoverability.** An AI agent (or a human reading JSON) can see the full
  action surface and understand what _could_ be possible, which helps it
  plan multi-step sequences.
- **Recourse.** `disabledReason` doubles as a hint. "Stop the agent before
  archiving" tells the caller what to do next. A hidden action teaches
  nothing.
- **Stable UI.** The web UI renders every button from the action list;
  disabled actions become greyed-out buttons with the reason as a tooltip.
  No client-side permission logic duplicated from the server.

`disabledReason` can be a `string` or a `string[]` — when multiple
independent conditions fail, each one is listed so the caller can address
them in any order.

### Two exceptions that use omission

1. **State-dependent visibility.** When an action simply doesn't apply to
   the current state (e.g. `unarchive` on a non-archived agent, `activate`
   on an active order), it's omitted entirely via `visibleWhen`. Emitting
   mutually-exclusive state actions as disabled would be noise.
2. **Destructive actions without permission.** When the caller has no
   permission at all for a destructive action (e.g. `delete` for a
   non-admin), `hideWithoutPermission: true` drops it. The caller can't
   improve their permission set by seeing the action, so showing it adds
   nothing.

Everything else uses `permGate()` or `disabledWhen()` to produce
`{ disabled: true, disabledReason: "..." }`. See the declarative
`resolveActions()` resolver in `packages/common/src/hateoas.ts`.

## Authentication: bearer tokens, never in URLs

Authentication is always by `Authorization: Bearer <key>` header.

```
Authorization: Bearer e7a3b9...
```

**Why not a query param or body field?**

- **Header doesn't get logged in URL lines.** Web server access logs,
  proxy logs, browser history, shell history (`curl` commands), error
  stack traces, and HTTP client request dumps all commonly include the
  URL. Headers are much less frequently captured by default.
- **Headers don't show up in `_links` or `_actions`.** The API surface
  itself is safe to log wholesale.
- **Clean separation of concerns.** URLs identify resources; auth is an
  orthogonal axis.

Extraction is standardised in `extractBearerToken()` at
`packages/common-node/src/bearerToken.ts`:

```typescript
export function extractBearerToken(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  return authHeader.slice(7);
}
```

Both the supervisor and ERP auth middleware fall through session cookies
first (for UI) and then bearer tokens (for agent / machine-to-machine
clients). API keys are hashed for cache keys with `hashToken()` so tokens
don't appear in any in-memory diagnostic structure either.

`HUB_ACCESS_KEY`, per-user API keys, and similar secrets are on the
`EXCLUDED_KEYS` list in `globalConfigLoader.ts` so the hub never distributes
them to clients through the variable channel.

## Schemas: one source of truth

Schemas are defined **once**, as Zod, and everything else flows from that:

```
Zod schema (shared package)
    │
    ├─► Fastify request validation  (fastify-type-provider-zod)
    ├─► Fastify response serialiser (trims fields in slim responses)
    ├─► OpenAPI spec                (@fastify/swagger + jsonSchemaTransform)
    ├─► Scalar API reference        (renders the spec at /api-reference)
    ├─► JSON Schema endpoint        (z.toJSONSchema) at /api/schemas/:name
    └─► action.schema pointer       (included in every action that needs a body)
```

The bridge is the `schemaRegistry` object in each app
(`apps/supervisor/server/src/schema-registry.ts`,
`apps/erp/server/src/schema-registry.ts`). Adding a new schema there:

1. Registers it with `z.globalRegistry` so OpenAPI `components.schemas` picks
   it up.
2. Makes it available at `GET /api/schemas/:name` as JSON Schema.
3. Lets actions reference it by pointing at the same path.

There is **no** hand-written OpenAPI YAML, **no** separate request/response
type file, and **no** schema duplication between server and shared packages.
Clients import the same Zod schemas from `@naisys/*-shared` packages that
the server uses for validation, so request/response shapes are type-checked
end-to-end.

## Keys, not ids, in URLs

Resource URLs use domain keys, not numeric database ids:

```
/erp/api/orders/WIDGET-01                        ✅ key
/erp/api/orders/WIDGET-01/revs/3                 ✅ semantic
/erp/api/orders/WIDGET-01/runs/7/ops/20/steps/10 ✅ full hierarchy visible

/erp/api/orders/42                                ❌ opaque id
```

**Why:**

- **Agents confuse numeric ids.** `order 42` and `operation 42` and `run 42`
  all look the same in a long-running conversation. `WIDGET-01` doesn't
  collide with `ASSEMBLY-STEP-3`.
- **Stable across environments.** A test DB and a prod DB will have the same
  `WIDGET-01` but different numeric ids. URLs and examples in docs keep
  working.
- **Self-describing.** `/orders/WIDGET-01/revs/3/ops/20/steps/10` reads like
  a path through the domain model. An agent can infer the hierarchy from
  the URL alone and often answer "what's the parent of this?" without
  another request.
- **Human-pasteable.** Debugging, support conversations, and log lines are
  all easier with keys.

Numeric ids still exist in the database and in response bodies (`id: 1234`)
so the client has a compact handle for optimistic updates, but they never
appear in the URL space.

Child segments (`/revs/{revNo}`, `/ops/{seqNo}`, `/steps/{stepSeqNo}`) use
sequence numbers scoped to their parent — also human-meaningful — rather
than global ids. Resolution walks the hierarchy; see `resolveOrder`,
`resolveRevision`, `resolveOperation`, `resolveStep`, `resolveOrderRun`,
`resolveOpRun`, `resolveStepRun` in `apps/erp/server/src/route-helpers.ts`.

## Discovery walkthrough

An agent lands on the ERP with only a base URL and an API key.

```
GET /erp/api/
→ { _links: [ self, me, orders, items, dispatch, schemas, api-reference, ... ],
    _actions: [ logout ] }

GET /erp/api/dispatch
→ open order runs — each item has { orderKey, runNo, _linkTemplates.item }

GET /erp/api/orders/WIDGET-01/runs/7/ops
→ operations list; each operation row carries status and
  _linkTemplates: [ { rel: item, hrefTemplate: ".../ops/{seqNo}" } ]

GET /erp/api/orders/WIDGET-01/runs/7/ops/20
→ detail: { status, _links: [ self, parent, steps, labor, comments ],
           _actions: [ start, complete (disabled: "Steps not complete"),
                       pause, uncomplete (hidden — wrong state) ] }

GET /erp/api/schemas/StartOperationRun          (on demand, if body unclear)
→ full JSON Schema

POST /erp/api/orders/WIDGET-01/runs/7/ops/20/start
     Authorization: Bearer <api-key>
     { }
→ { success: true, id: 9981, _actions: [ complete, pause, ... ] }
```

Every step after the first is informed by the previous response. The agent
never loads a catalog, never guesses a URL, and gets a reason when something
can't be done.

## Implementation patterns

### Co-located action builders

Generic HATEOAS helpers (`selfLink`, `collectionLink`, `schemaLink`,
`paginationLinks`, `idCursorLinks`, `timestampCursorLinks`) live in
`apps/<app>/server/src/hateoas.ts`. **Domain-specific** `xActions()` /
`xLinks()` / `formatX()` builders live in the **same file as the routes
that emit them**:

- `routes/agents.ts` → `agentActions()`, `agentLinks()`
- `routes/users.ts` → `userActions()`, `userItemLinks()`, `permissionActions()`, `formatUser()`, `formatListUser()`
- `routes/orders.ts` → `orderActions()`, `orderLinks()`, `formatOrder()`, `formatListOrder()`

The HATEOAS surface is part of the route's contract; keeping them in the
same file means you can't add an endpoint without seeing the actions it
should appear in, and you can't add an action without seeing where it's
emitted.

### Declarative resolver

Action lists are built declaratively so that status-gating, permission-
gating, visibility, and disabled-reason logic are all expressed in one
place per action:

```typescript
resolveActions(
  [
    {
      rel: "start",
      path: "/start",
      method: "POST",
      title: "Start Agent",
      schema: `${API_PREFIX}/schemas/StartAgent`,
      body: { task: "" },
      permission: "manage_agents",
      disabledWhen: (ctx) =>
        ctx.active
          ? "Agent is already running"
          : ctx.archived
            ? "Agent is archived"
            : !ctx.enabled
              ? "Agent is disabled"
              : null,
    },
    // ...
  ],
  href,
  { user, active, archived, enabled, hasSpendLimit },
);
```

`permission` produces `permGate()`-style disabling;
`statuses: [...]` / `visibleWhen()` produce omission;
`hideWithoutPermission: true` is the rare suppress-when-no-permission
escape hatch. `disabledWhen()` is the general-purpose state guard.

### Client-side consumption

Client code never has a local policy for "who can do what." It calls
`hasAction(actions, "rel")` (optionally `{ includeDisabled: true }` to
render a greyed-out button) and trusts the server's answer. For the UI,
`formatDisabledReason()` normalises the `string | string[]` variant to a
single tooltip line.

## Files

| File                                                   | Role                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/common/src/hateoas-types.ts`                 | Zod schemas for `HateoasLink`, `HateoasAction`, templates, `AlternateEncoding`                                                                                    |
| `packages/common/src/hateoas.ts`                       | `hasAction`, `hasActionTemplate`, `hasLinkTemplate`, `resolveActions`, `permGate`, `formatDisabledReason`                                                         |
| `packages/common-node/src/bearerToken.ts`              | `extractBearerToken()`                                                                                                                                            |
| `packages/common-node/src/hashToken.ts`                | `hashToken()` for auth cache keys                                                                                                                                 |
| `apps/supervisor/server/src/hateoas.ts`                | Supervisor generic helpers: `selfLink`, `collectionLink`, `schemaLink`, `paginationLinks`, `timestampCursorLinks`, `idCursorLinks`, `attachmentUrl`, `API_PREFIX` |
| `apps/supervisor/server/src/route-helpers.ts`          | Supervisor-typed `resolveActions` wrapper                                                                                                                         |
| `apps/supervisor/server/src/schema-registry.ts`        | Supervisor Zod → OpenAPI + JSON Schema registry                                                                                                                   |
| `apps/supervisor/server/src/routes/root.ts`            | Supervisor API discovery root                                                                                                                                     |
| `apps/supervisor/server/src/routes/schemas.ts`         | `GET /schemas/`, `GET /schemas/:name`                                                                                                                             |
| `apps/supervisor/server/src/api-reference.ts`          | Scalar API reference at `/supervisor/api-reference`                                                                                                               |
| `apps/erp/server/src/hateoas.ts`                       | ERP generic helpers (mirror of supervisor's)                                                                                                                      |
| `apps/erp/server/src/route-helpers.ts`                 | ERP-typed `resolveActions`, `mutationResult`, `wantsFullResponse`, `draftCrudActions`, status guards, resolution chains                                           |
| `apps/erp/server/src/schema-registry.ts`               | ERP Zod → OpenAPI + JSON Schema registry                                                                                                                          |
| `apps/erp/server/src/routes/root.ts`                   | ERP API discovery root                                                                                                                                            |
| `apps/erp/server/src/routes/schemas.ts`                | ERP schema endpoints                                                                                                                                              |
| `apps/erp/server/src/routes/step-runs.ts`              | Canonical example of `_actionTemplates` + `alternateEncoding`                                                                                                     |
| `apps/erp/server/src/routes/step-field-attachments.ts` | Canonical example of multipart upload handler                                                                                                                     |
| `apps/erp/server/src/erpRoutes.ts`                     | Route mount table — shows the URL hierarchy (keys, not ids)                                                                                                       |
| `apps/erp/server/src/api-reference.ts`                 | Scalar API reference at `/erp/api-reference`                                                                                                                      |

## Adding a new action — the checklist

1. **Shared schema**: add/extend a Zod schema in `apps/<app>/shared/src/*-types.ts`.
2. **Schema registry**: register it in `apps/<app>/server/src/schema-registry.ts`.
3. **Route handler**: add the endpoint in `routes/<resource>.ts` with
   `preHandler: requirePermission(...)`.
4. **Action list**: add an entry to `xActions()` in the _same_ file, with
   the appropriate `permission`, `disabledWhen`, `visibleWhen`, and/or
   `statuses`.
5. **Response formatter**: if the mutation should return an updated view,
   add a case in `formatX()` that recomputes `_actions` against the new
   state.
6. **Client**: add a typed fetch wrapper in `client/src/lib/api<Resource>.ts`
   and gate the UI button on `hasAction(actions, "rel")`. No client-side
   permission check needed.

For multipart uploads, add `alternateEncoding: { contentType, description,
fileFields: [...] }` to the action or action template instead of `body`.

## Future considerations

- **`curies` / rel documentation endpoint.** Add a `rels` endpoint that
  returns human-readable descriptions per `rel` name — lets an agent look
  up "what does `rotate-key` actually do?" without guessing from the
  title.
- **Error envelope consistency.** Extend the 4xx/5xx error shape to always
  include a `disabledReason`-style `hint` field so agents get the same
  recourse affordance on failures that they get on disabled actions.
- **Versioning.** When action semantics change in a breaking way we'll want
  a `deprecation` / `successor` pointer on the action rather than a
  URL-versioned API; the rel names give us a natural place to hang that.
- **Per-action rate hints.** `Retry-After`-style metadata on actions that
  have quota semantics (e.g. `reset-spend`, message-send).

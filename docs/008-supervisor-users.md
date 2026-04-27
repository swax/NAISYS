# NAISYS Supervisor - User Management

**Status: Implemented**

## Overview

The Supervisor Users page provides user and permission management for the NAISYS Supervisor application. It follows the same AI-first, HATEOAS-driven design philosophy as the ERP module: an AI agent should be able to discover and operate the entire user management system starting from the API root, with the web UI as a thin client over the same REST API.

## Design Philosophy

The supervisor API is fully discoverable and operable by AI, just like the ERP. The user management endpoints follow the same HATEOAS patterns: `_links` for navigation, `_actions` for state-dependent operations, `_linkTemplates` for parameterised item URLs, and schema endpoints for request body discovery.

Server-side enforcement uses a single `requirePermission(...)` middleware plus a `requireAdminOrSelf` guard for the update endpoint. Client-side UI is driven by the `_actions` returned on each resource — buttons are rendered/disabled from those actions via `hasAction()` and `permGate()` rather than from ad-hoc permission checks.

## Navigation

Page navigation lives in `apps/supervisor/client/src/headers/navTabs.ts`. Tabs are filtered in `AppHeader` by `hasPermission(tab.permission)`. A tab without a `permission` field is always visible when authenticated.

```ts
export const navTabs: NavTab[] = [
  { path: "/agents", label: "Agents" },
  { path: "/hosts", label: "Hosts" },
  { path: "/variables", label: "Variables" },
  { path: "/models", label: "Models" },
  { path: "/costs", label: "Costs" },
  { path: "/users", label: "Users" },
  { path: "/admin", label: "Admin", permission: "supervisor_admin" },
];
```

The `Users` tab is visible to all authenticated users (a non-admin can view the list and their own detail). The `Admin` tab is `supervisor_admin`-only. Per-action admin gating happens in the UI via `_actions` returned from the API.

The authenticated user menu in `AppHeader.tsx` also has a "My User" item that links to `/users/:username` for the current user.

## Data Model

### Permission Enum

Permissions are defined as a Prisma enum on the supervisor database (`packages/supervisor-database/prisma/schema.prisma`). New permissions are added to the enum as the system grows.

```prisma
enum Permission {
  supervisor_admin
  manage_agents
  remote_execution
  manage_hosts
  agent_communication
  manage_models
  manage_variables
  view_run_logs
}
```

| Permission            | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `supervisor_admin`    | Full access, including user management                                  |
| `manage_agents`       | Create, configure, start/stop, pause/resume, archive, and delete agents |
| `remote_execution`    | Send arbitrary commands to an agent's active run (remote shell access)  |
| `manage_hosts`        | Register and manage agent hosts                                         |
| `agent_communication` | Send messages to agents via mail and chat                               |
| `manage_models`       | Add, edit, and remove LLM model configurations                          |
| `manage_variables`    | Manage global variables used by agents                                  |
| `view_run_logs`       | View unobfuscated run logs                                              |

Human-readable descriptions for each permission are maintained alongside the Zod enum in `apps/supervisor/shared/src/user-types.ts` as `PermissionDescriptions`.

`supervisor_admin` is treated as a superset — `hasPermission(user, X)` returns true if the user holds `X` **or** `supervisor_admin`. This lives in `auth-middleware.ts` (server) and `SessionContext.tsx` (client) as identical logic.

### User Model

Instead of an `AuthType` enum, the User model uses an `isAgent` boolean together with an optional `apiKey` string. Humans authenticate with passkeys (WebAuthn); agent users have `isAgent=true`, no passkeys, and look up their API key in the hub database by uuid (see _Hub API User Auto-Provisioning_).

```prisma
model User {
  id                 Int                 @id @default(autoincrement())
  username           String              @unique
  uuid               String              @default("")
  isAgent            Boolean             @default(false) @map("is_agent")
  createdAt          DateTime            @default(now()) @map("created_at")
  apiKey             String?             @unique @map("api_key")
  updatedAt          DateTime            @updatedAt @map("updated_at")
  permissions        UserPermission[]    @relation("UserPermissions")
  grantedPermissions UserPermission[]    @relation("GrantedByPermissions")
  sessions           Session[]
  passkeyCredentials PasskeyCredential[]
  registrationTokens RegistrationToken[]

  @@map("users")
}
```

Credential storage lives in companion tables — `passkey_credentials` (WebAuthn public keys + signature counters + device labels) and `registration_tokens` (one-time bootstrap links). See [doc 007](./007-web-auth.md) for the full schema and ceremony details.

### UserPermission Model

A join table mapping users to their granted permissions. `grantedBy` is nullable so that the bootstrap `supervisor_admin` grant (no grantor exists yet) can be recorded.

```prisma
model UserPermission {
  id            Int        @id @default(autoincrement())
  userId        Int        @map("user_id")
  permission    Permission
  grantedAt     DateTime   @default(now()) @map("granted_at")
  grantedBy     Int?       @map("granted_by")
  user          User       @relation("UserPermissions", fields: [userId], references: [id], onDelete: Cascade)
  grantedByUser User?      @relation("GrantedByPermissions", fields: [grantedBy], references: [id])

  @@unique([userId, permission])
  @@map("user_permissions")
}
```

### Admin Bootstrap

`ensureSuperAdmin()` in `packages/supervisor-database/src/sessionService.ts` creates the `superadmin` user on boot if missing and grants it `supervisor_admin`. **No credential is set** — `bootstrapSupervisor()` issues a one-time registration token and prints the URL to stdout so the operator can register a passkey on first launch. No other permissions are granted by default — because `supervisor_admin` is a superset, the admin user has full access without needing the other seven permissions explicitly. It is called from `supervisorServer.ts` after migrations, before routes register.

A registration link is also re-issued automatically when the operator runs with `--setup` and confirms a reset, or when the superadmin has no passkey and no unexpired token (recovery / failed prior setup). See [doc 007](./007-web-auth.md) for the full bootstrap and recovery flow.

## API Design

**Base path**: `/supervisor/api/users` (mounted in `routes/api.ts` with prefix `/users`).

All endpoints require authentication. Write endpoints require `supervisor_admin` via the `requirePermission("supervisor_admin")` preHandler. Credential-management endpoints (passkey list/delete, registration-token issuance) use `requireAdminOrSelf` so a user can manage their own credentials without admin. Sensitive actions (create user, registration-token issuance, passkey delete, passkey reset) additionally call `requireStepUp()`; see [doc 007](./007-web-auth.md) for the step-up flow.

### API Root Discovery

`GET /supervisor/api/` (`routes/root.ts`) returns link discovery. The `users` and `admin` links are only added when the authenticated user holds `supervisor_admin`:

```json
{
  "_links": [
    { "rel": "self", "href": "/supervisor/api/" },
    {
      "rel": "auth-me",
      "href": "/supervisor/api/auth/me",
      "title": "Current User"
    },
    {
      "rel": "schemas",
      "href": "/supervisor/api/schemas/",
      "title": "Schemas"
    },
    { "rel": "agents", "href": "/supervisor/api/agents", "title": "Agents" },
    { "rel": "hosts", "href": "/supervisor/api/hosts", "title": "Hosts" },
    { "rel": "models", "href": "/supervisor/api/models", "title": "Models" },
    {
      "rel": "variables",
      "href": "/supervisor/api/variables",
      "title": "Variables"
    },
    {
      "rel": "permissions",
      "href": "/supervisor/api/permissions",
      "title": "Available Permissions"
    },
    {
      "rel": "users",
      "href": "/supervisor/api/users",
      "title": "User Management"
    },
    { "rel": "admin", "href": "/supervisor/api/admin", "title": "Admin" }
  ]
}
```

`GET /supervisor/api/permissions` returns the enumeration of permission names (`PermissionEnum.options`) so clients can drive "grant permission" dropdowns without hardcoding.

### Users API

Endpoints are keyed by **username** (the stable URL-safe identifier), not numeric id.

#### List Users

```
GET /supervisor/api/users?page=1&pageSize=20&search=
```

List items are deliberately compact (no per-item permissions, no actions). Actions live on the collection (create) and on each detail resource.

```json
{
  "items": [
    {
      "id": 1,
      "uuid": "...",
      "username": "admin",
      "isAgent": false,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "permissionCount": 1
    }
  ],
  "total": 1,
  "pageSize": 20,
  "_links": [
    { "rel": "self", "href": "/supervisor/api/users?page=1&pageSize=20" },
    { "rel": "first", "href": "/supervisor/api/users?page=1&pageSize=20" },
    { "rel": "last", "href": "/supervisor/api/users?page=1&pageSize=20" }
  ],
  "_linkTemplates": [
    { "rel": "item", "hrefTemplate": "/supervisor/api/users/{username}" }
  ],
  "_actions": [
    {
      "rel": "create",
      "href": "/supervisor/api/users",
      "method": "POST",
      "title": "Create User",
      "schema": "/supervisor/api/schemas/CreateUser",
      "body": { "username": "" }
    },
    {
      "rel": "create-from-agent",
      "href": "/supervisor/api/users/from-agent",
      "method": "POST",
      "title": "Import User from Agent",
      "schema": "/supervisor/api/schemas/CreateAgentUser",
      "body": { "agentId": 0 }
    }
  ]
}
```

Actions are always emitted. When the caller lacks the required permission, the action carries `disabled: true` and a `disabledReason` (see _Action Gating_), so clients can render every action predictably and the UI can explain why something is unavailable. Each action also carries a `body` stub that matches its schema, useful both for the UI and for AI callers that want to see the shape inline.

#### Get User Detail

```
GET /supervisor/api/users/:username
```

```json
{
  "id": 1,
  "username": "superadmin",
  "isAgent": false,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "apiKey": "...",
  "hasApiKey": true,
  "permissions": [
    {
      "permission": "supervisor_admin",
      "grantedAt": "2025-01-01T00:00:00.000Z",
      "grantedBy": null,
      "_actions": []
    }
  ],
  "_links": [
    { "rel": "self", "href": "/supervisor/api/users/superadmin" },
    { "rel": "collection", "href": "/supervisor/api/users", "title": "users" },
    { "rel": "schema", "href": "/supervisor/api/schemas/UpdateUser" }
  ],
  "_actions": [
    {
      "rel": "update",
      "href": "/supervisor/api/users/superadmin",
      "method": "PUT",
      "title": "Update",
      "schema": "/supervisor/api/schemas/UpdateUser",
      "body": { "username": "" }
    },
    {
      "rel": "grant-permission",
      "href": "/supervisor/api/users/superadmin/permissions",
      "method": "POST",
      "title": "Grant Permission",
      "schema": "/supervisor/api/schemas/GrantPermission",
      "body": { "permission": "" }
    },
    {
      "rel": "rotate-key",
      "href": "/supervisor/api/users/superadmin/rotate-key",
      "method": "POST",
      "title": "Rotate API Key"
    },
    {
      "rel": "issue-registration",
      "href": "/supervisor/api/users/superadmin/registration-token",
      "method": "POST",
      "title": "Issue Registration Link"
    }
    // "reset-passkeys" is emitted only for admin viewing another user
    // "delete" is omitted entirely when isSelf
  ]
}
```

Notes on the response shape:

- `apiKey` is only included when the **caller** is `supervisor_admin`; non-admins never see anyone's key (including their own) via this endpoint. `hasApiKey` is always included.
- For agent users (`isAgent: true`) the server looks up the key in the hub DB via `getUserApiKey()` — agent keys are stored in the hub `users` table, not the supervisor `users` table.
- If the user is an agent, `_links` also includes `{ "rel": "agent", "href": "/supervisor/api/agents/<agent-username>" }`.
- `issue-registration` is emitted to admin (any user) and self (own row), so anyone can mint a fresh registration link for adding a passkey on a new device.
- `reset-passkeys` is admin-only and never emitted on self (admins use `issue-registration` on themselves).
- The `delete` action is omitted when viewing self. The `revoke` action on a permission entry is omitted for `(self, supervisor_admin)` — you cannot revoke your own supervisor_admin.

Each permission entry has its own `_actions`:

```json
{
  "permission": "manage_agents",
  "grantedAt": "2025-01-01T00:00:00.000Z",
  "grantedBy": 1,
  "_actions": [
    {
      "rel": "revoke",
      "href": "/supervisor/api/users/admin/permissions/manage_agents",
      "method": "DELETE",
      "title": "Revoke"
    }
  ]
}
```

#### Create User

```
POST /supervisor/api/users
```

```json
{ "username": "operator", "stepUpAssertion": { ... } }
```

Requires `supervisor_admin` and step-up auth (the body carries a `stepUpAssertion` proving the caller still holds a passkey — see [doc 007](./007-web-auth.md)). Username must be url-safe (`URL_SAFE_KEY_REGEX`, 1–64 chars). Server generates a `uuid` and a 32-byte hex `apiKey`. **No credential is set on the new user** — the response includes a one-time registration URL the operator must open to register a passkey.

Response: `201 { success, message, id, username, registrationUrl, registrationExpiresAt }`. A `409` is returned on username conflict; a `412` is returned when step-up is required but missing.

#### Create User From Agent

```
POST /supervisor/api/users/from-agent
```

```json
{ "agentId": 42 }
```

Imports an existing hub agent as a supervisor user, linking by uuid. Creates a local `User` with `isAgent: true` and no passkeys. Conflicts on duplicate uuid or username. Requires `supervisor_admin`. This is the same shape as the lazy auto-provision path (see below), just driven explicitly.

Response: `201 { success, message, id, username }`.

#### Update User

```
PUT /supervisor/api/users/:username
```

```json
{ "username": "new-name" }
```

Username-only. Requires `supervisor_admin`. Credentials are managed through the dedicated endpoints (`registration-token`, `passkeys/:id/delete`, `reset-passkeys`); this endpoint never accepts a credential field. On success the auth cache is cleared wholesale (see _Auth Cache Integration_).

Response: `{ success, message }`. Conflicts on duplicate username return `409`.

#### Issue Registration Link

```
POST /supervisor/api/users/:username/registration-token
```

```json
{ "stepUpAssertion": { ... } }
```

Issues a one-time registration link (and revokes any prior unused link for that user). Returned URL points at `/supervisor/register?token=…`; the recipient opens it in a browser to register a passkey. The supervisor UI displays the URL alongside a QR code for easy phone enrollment (suppressed when the URL is loopback-only — see [doc 007](./007-web-auth.md)). Guarded by `requireAdminOrSelf` plus step-up. Self-issuance is refused when the caller has no passkey — the legitimate path in that case is an admin-issued link.

Response: `{ username, registrationUrl, expiresAt }`.

#### Reset Passkeys (admin recovery)

```
POST /supervisor/api/users/:username/reset-passkeys
```

Wipes every passkey for the user, revokes all of their sessions, and issues a fresh registration link. Admin-only and refuses to target self (admins use `issue-registration` on themselves). Step-up required.

Response: `{ username, registrationUrl, expiresAt }`.

#### List / Delete Passkeys

```
GET  /supervisor/api/users/:username/passkeys
POST /supervisor/api/users/:username/passkeys/:id/delete
```

`GET` returns each credential's `id`, `deviceLabel`, `createdAt`, and `lastUsedAt`. `POST .../delete` (POST not DELETE so the step-up body fits) removes a single passkey; both endpoints accept admin or self. After deletion, all sessions for the target user are revoked except the actor's own — and even the actor's session is dropped if the deletion left them with no passkey.

#### Delete User

```
DELETE /supervisor/api/users/:username
```

Requires `supervisor_admin`. Returns `409` if the caller targets themselves ("Cannot delete yourself"). Cascades delete `user_permissions` and `sessions`.

Response: `{ success, message }`.

#### Rotate API Key

```
POST /supervisor/api/users/:username/rotate-key
```

Requires `supervisor_admin`. Generates a new 32-byte hex key. For a regular user, writes it to `users.api_key`. For an agent user, delegates to `rotateAgentApiKeyByUuid()` which updates the hub database.

Response: `{ success, message }`. Clears the auth cache.

### Permissions API

#### Grant Permission

```
POST /supervisor/api/users/:username/permissions
```

```json
{ "permission": "manage_agents" }
```

Requires `supervisor_admin`. Conflicts return `409 "Permission already granted"`.

Response: `{ success, message }`. Clears the auth cache.

#### Revoke Permission

```
DELETE /supervisor/api/users/:username/permissions/:permission
```

Requires `supervisor_admin`. Returns `409` if the caller targets their own `supervisor_admin`.

Response: `{ success, message }`. Clears the auth cache.

### Schema Endpoints

Schemas are served from a single top-level endpoint registered in `routes/schemas.ts`, backed by a `schemaRegistry` object that every module contributes to at registration time.

```
GET /supervisor/api/schemas/        → { "schemas": [...names] }
GET /supervisor/api/schemas/:name   → JSON Schema (via Zod's z.toJSONSchema)
```

Names contributed by the users module: `CreateUser`, `UpdateUser`, `GrantPermission`, `CreateAgentUser`. Auth-flow schemas (`StepUpAssertionBody`, `RegistrationToken*`, etc.) are contributed separately by the auth module.

## Permission Enforcement

### Server-Side

```typescript
// apps/supervisor/server/src/auth-middleware.ts
export function hasPermission(user, permission): boolean {
  return (user?.permissions.includes(permission)
       || user?.permissions.includes("supervisor_admin")) ?? false;
}

export function requirePermission(permission: Permission) {
  return async (request, reply) => {
    if (!request.supervisorUser) return reply.status(401).send({ ... });
    if (!hasPermission(request.supervisorUser, permission))
      return reply.status(403).send({
        statusCode: 403, error: "Forbidden",
        message: `Permission '${permission}' required`,
      });
  };
}
```

Most write routes on `/supervisor/api/users` use `requirePermission("supervisor_admin")` as their preHandler. The credential-management endpoints (passkey list/delete, registration-token issuance) use `requireAdminOrSelf` so users can manage their own credentials. Step-up is layered on top of those for the sensitive flows. GETs are authenticated but open to any logged-in user — the list endpoint deliberately returns compact rows with no sensitive fields so non-admins can see who else exists.

Permissions other than `supervisor_admin` are enforced on their respective feature endpoints (for example, `manage_agents` on agent lifecycle routes). Those live outside this module and are out of scope here.

### Client-Side (Action Gating)

The server emits every action a user might see and marks the ones they cannot invoke as `disabled` with a `disabledReason`:

```typescript
// packages/common/src/hateoas.ts
export function permGate(hasPerm: boolean, permission: Permission) {
  return hasPerm
    ? {}
    : { disabled: true, disabledReason: `Requires '${permission}' permission` };
}
```

The client renders buttons from `_actions` using `hasAction(actions, "rel")` (returns the action if emitted) and disables/annotates them based on the action's `disabled` flag. This keeps the UI source of truth on the server — add a new action to the server response and the UI surfaces it; gate it and the UI shows why.

A handful of cases are handled by **omission** instead of gating:

- `delete` is omitted from user actions when viewing self.
- `revoke` is omitted from permission actions when the target is `(self, supervisor_admin)`.
- `issue-registration` is omitted unless the caller is admin or self.
- `reset-passkeys` is omitted when viewing self.

State-dependent guards (self-protection, "credential exists") are omitted outright; permission-dependent guards use `permGate()`.

### Hub API User Auto-Provisioning

When an API-key-based agent from the hub makes a request to the supervisor, the auth middleware resolves it lazily:

1. `resolveUserFromApiKey(apiKey)` looks up the key in the supervisor DB (`findUserByApiKey`) first, then falls back to the hub DB (`findAgentByApiKey`).
2. If the match is from the hub, `getUserByUuid(match.uuid)` checks for a pre-existing local supervisor user.
3. If absent, `createUserForAgent(username, uuid)` creates a local `User` row with `isAgent: true`, no passkeys, and null `apiKey` (the key stays in the hub).
4. Permissions are loaded from the local supervisor DB via `getUserPermissions(id)`. Auto-provisioned agents get **no** permissions by default — an admin must grant them explicitly before they can do anything beyond reading public data.

The same flow is available as the explicit `POST /users/from-agent` endpoint (admin-driven, picks an agent by hub id).

### Auth Cache Integration

`packages/common/src/authCache.ts` provides a shared `AuthCache<SupervisorUser>` used by both session-cookie auth and API-key auth.

```typescript
interface SupervisorUser {
  id: number;
  username: string;
  uuid: string;
  permissions: Permission[];
}
```

Cache keys are `cookie:${hashToken(token)}` or `apikey:${hashToken(apiKey)}`. `null` is cached for unknown tokens (short TTL) to short-circuit floods of bad requests.

Any mutation that changes users or permissions (update, delete, grant, revoke, rotate-key, passkey delete, reset-passkeys) calls `authCache.clear()`. This is coarser than per-user invalidation but keeps the logic simple, and the cache rebuilds on the next request. Logout invalidates the single cache entry tied to the cookie.

## HATEOAS Implementation

### Shared Types

The HATEOAS type definitions live in `packages/common/src/hateoas-types.ts`:

- `HateoasLinkSchema`, `HateoasActionSchema`
- `HateoasLinkTemplateSchema`, `HateoasActionTemplateSchema`
- `HateoasLinksSchema` (the standard `{ _links, _actions }` envelope)

The client-side utilities live in `packages/common/src/hateoas.ts`:

- `hasAction()`, `hasActionTemplate()`, `hasLinkTemplate()`
- `resolveActions()` — declarative action builder used server-side
- `permGate()`, `formatDisabledReason()`

Both the supervisor and the ERP import from `@naisys/common`. The ERP's `apps/erp/shared/src/hateoas-types.ts` is a thin re-export of the common types for backwards compatibility with existing ERP imports.

### Server Helpers

Helpers are split by scope:

`apps/supervisor/server/src/hateoas.ts` — **generic** helpers reusable across every route file:

```ts
export const API_PREFIX = "/supervisor/api";
export function selfLink(path, title?): HateoasLink
export function collectionLink(resource): HateoasLink
export function schemaLink(schemaName): HateoasLink
export function paginationLinks(basePath, page, pageSize, total, filters?)
export function timestampCursorLinks(...)
export function idCursorLinks(...)
export function attachmentUrl(id, filename)
```

Domain-specific action/link builders are **co-located with their route file**, not hoisted into `hateoas.ts`. This keeps the HATEOAS surface and the endpoints that emit it visible in the same place. For users:

```ts
// apps/supervisor/server/src/routes/users.ts
function userItemLinks(username, agentUsername?): HateoasLink[];
function userActions(username, isSelf, isAdmin): HateoasAction[];
function permissionActions(
  username,
  permission,
  isSelf,
  isAdmin,
): HateoasAction[];
function formatUser(user, currentUserId, currentUserPermissions, options);
function formatListUser(user);
```

The same pattern applies for agents (`routes/agents.ts` carries `agentActions()` / `agentLinks()`), hosts, models, etc.

### Response Formatters

`formatUser()` is the single source of truth for the detail payload. It takes the DB row plus the **caller's** id and permissions and returns the full resource:

```typescript
function formatUser(user, currentUserId, currentUserPermissions, options) {
  const isSelf = user.id === currentUserId;
  const isAdmin = currentUserPermissions.includes("supervisor_admin");
  const apiKeyValue = options?.apiKey ?? null;
  return {
    id: user.id,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    apiKey: isAdmin ? apiKeyValue : undefined,
    hasApiKey: apiKeyValue !== null,
    permissions: user.permissions.map((p) => ({
      permission: p.permission,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantedBy,
      _actions: permissionActions(user.username, p.permission, isSelf, isAdmin),
    })),
    _links: userItemLinks(user.username, options?.agentUsername),
    _actions: userActions(user.username, isSelf, isAdmin),
  };
}
```

`formatListUser()` returns the compact row used by `GET /users`.

## Web UI

### User List Page (`/users`)

`apps/supervisor/client/src/pages/users/UserList.tsx`. A paginated Mantine table of users with search and the `create` / `create-from-agent` actions gated via `hasAction()` + `permGate()`.

Columns: Username, Agent? (from `isAgent`), Created, Permission count.

Clicking a row navigates to `/users/:username` (resolved from the `item` link template).

### User Detail Page (`/users/:username`)

`apps/supervisor/client/src/pages/users/UserDetail.tsx`. Shows:

- **User info card**: username, isAgent, created/updated dates, API key (visible to admins only — from `apiKey` field in response), with a "Rotate API Key" button (gated by `_actions.rotate-key`).
- **Edit username**: inline edit (gated by `_actions.update`).
- **Permissions list**: each entry has a revoke button rendered from its `_actions.revoke`.
- **Grant permission**: dropdown of not-yet-granted permissions + button (gated by `_actions.grant-permission`). The dropdown options are fed by `GET /permissions` and filtered against the current `permissions[]`.
- **Passkeys list**: per-credential delete buttons; each delete runs the step-up dance.
- **Issue Registration Link**: gated by `_actions.issue-registration`. Triggers step-up, then surfaces the URL alongside a QR code (suppressed for loopback URLs — see [doc 007](./007-web-auth.md)).
- **Reset Passkeys**: admin-only on other users (`_actions.reset-passkeys`); same surfacing.
- **Delete**: delete button gated by `_actions.delete` (omitted for self).

All buttons use `hasAction()` + action `disabled`/`disabledReason` for rendering — no component imports `useSession().hasPermission()` to decide what to show in the users UI. Sensitive actions go through `postWithStepUp()` which transparently runs a passkey assertion before the request.

### Client Routing

`App.tsx` declares:

```
/users               → UserList
/users/:username     → UserDetail
```

The root `<AppContent />` fetches `/supervisor/api/client-config` once on mount (plugins, publicRead, permissions) and exposes `permissions` via the router `Outlet` context. `SessionContext` exposes the authenticated user (including `permissions`) and the `hasPermission(p)` helper used by the nav.

### API Client

`apps/supervisor/client/src/lib/apiUsers.ts`:

```typescript
getUsers(params)                → GET /users?page=&pageSize=&search=
getUser(username)               → GET /users/:username
createUser(data)                → POST /users (with step-up body)
createAgentUser(agentId)        → POST /users/from-agent
updateUser(username, data)      → PUT /users/:username  (username only)
deleteUser(username)            → DELETE /users/:username
grantPermission(username, p)    → POST /users/:username/permissions
revokePermission(username, p)   → DELETE /users/:username/permissions/:p
rotateUserApiKey(username)      → POST /users/:username/rotate-key
```

`apiAuth.ts` handles login/logout/getMe and the WebAuthn / step-up / registration plumbing — see [doc 007](./007-web-auth.md). `getMe()` returns `AuthUser` with `{ id, username, permissions }`.

## Implementation Layout

### Server

| Path                                                                   | Purpose                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/supervisor-database/prisma/schema.prisma`                    | `Permission` enum, `User`, `UserPermission`, `Session`, `PasskeyCredential`, `RegistrationToken`                  |
| `packages/supervisor-database/src/sessionService.ts::ensureSuperAdmin` | Admin bootstrap (grants `supervisor_admin` only, no credentials)                                                  |
| `packages/supervisor-database/src/passkeyService.ts`                   | Passkey CRUD + registration-token issuance and atomic consume                                                     |
| `apps/supervisor/server/src/routes/users.ts`                           | Users + permissions + credential management endpoints, domain HATEOAS builders, formatters                        |
| `apps/supervisor/server/src/routes/auth.ts`                            | Passkey login/register endpoints, step-up options                                                                 |
| `apps/supervisor/server/src/routes/schemas.ts`                         | Schema discovery                                                                                                  |
| `apps/supervisor/server/src/routes/root.ts`                            | API root `_links` + `/permissions` enum endpoint                                                                  |
| `apps/supervisor/server/src/services/userService.ts`                   | User + permission business logic                                                                                  |
| `apps/supervisor/server/src/services/passkeyService.ts`                | WebAuthn options/verify, registration-link helpers                                                                |
| `apps/supervisor/server/src/services/stepUpService.ts`                 | `requireStepUp()` — gates sensitive routes with a fresh credential proof                                          |
| `apps/supervisor/server/src/auth-middleware.ts`                        | `SupervisorUser`, authCache, `requirePermission`, auto-provisioning                                               |
| `apps/supervisor/server/src/hateoas.ts`                                | Generic HATEOAS helpers                                                                                           |
| `apps/supervisor/server/src/route-helpers.ts`                          | `permGate` + `resolveActions` wrappers                                                                            |
| `apps/supervisor/server/src/schema-registry.ts`                        | Registry backing `/schemas/*`                                                                                     |
| `apps/supervisor/shared/src/user-types.ts`                             | Zod: `PermissionEnum`, `CreateUser`, `UpdateUser`, `GrantPermission`, `CreateAgentUser`, `PermissionDescriptions` |
| `apps/supervisor/shared/src/auth-types.ts`                             | Zod: passkey + step-up + registration-token request/response schemas, `AuthUser` (id, username, permissions[])    |

### Client

| Path                                                     | Purpose                                             |
| -------------------------------------------------------- | --------------------------------------------------- |
| `apps/supervisor/client/src/App.tsx`                     | `/users` + `/users/:username` routes, client-config |
| `apps/supervisor/client/src/headers/navTabs.ts`          | Nav tab config (Users visible, Admin admin-gated)   |
| `apps/supervisor/client/src/headers/AppHeader.tsx`       | Header rendering, `My User` menu link               |
| `apps/supervisor/client/src/pages/users/UserList.tsx`    | User list page                                      |
| `apps/supervisor/client/src/pages/users/UserDetail.tsx`  | User detail + permissions management                |
| `apps/supervisor/client/src/lib/apiUsers.ts`             | Users API client                                    |
| `apps/supervisor/client/src/contexts/SessionContext.tsx` | Auth state, `hasPermission()`                       |

### Shared

| Path                                   | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `packages/common/src/hateoas-types.ts` | `HateoasLink`, `HateoasAction`, templates, envelopes       |
| `packages/common/src/hateoas.ts`       | `hasAction`, `resolveActions`, `permGate`                  |
| `packages/common/src/authCache.ts`     | Shared `AuthCache<T>` used by both supervisor and ERP auth |
| `apps/erp/shared/src/hateoas-types.ts` | Re-exports from `@naisys/common`                           |

## API Endpoints Summary

| Method | Path                                                  | Description                                 | Permission                                      |
| ------ | ----------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| GET    | `/supervisor/api/`                                    | API discovery root                          | (authenticated)                                 |
| GET    | `/supervisor/api/permissions`                         | Enumerate available permissions             | (authenticated)                                 |
| GET    | `/supervisor/api/users`                               | List users (paginated)                      | (authenticated)                                 |
| POST   | `/supervisor/api/users`                               | Create user (returns registration link)     | `supervisor_admin` + step-up                    |
| POST   | `/supervisor/api/users/from-agent`                    | Import hub agent as user                    | `supervisor_admin`                              |
| GET    | `/supervisor/api/users/:username`                     | Get user detail                             | (authenticated)                                 |
| PUT    | `/supervisor/api/users/:username`                     | Update username                             | `supervisor_admin`                              |
| DELETE | `/supervisor/api/users/:username`                     | Delete user                                 | `supervisor_admin` (not self)                   |
| POST   | `/supervisor/api/users/:username/rotate-key`          | Rotate API key                              | `supervisor_admin`                              |
| POST   | `/supervisor/api/users/:username/permissions`         | Grant permission                            | `supervisor_admin`                              |
| DELETE | `/supervisor/api/users/:username/permissions/:perm`   | Revoke permission                           | `supervisor_admin` (not own `supervisor_admin`) |
| POST   | `/supervisor/api/users/:username/registration-token`  | Issue one-time registration link            | admin or self + step-up                         |
| POST   | `/supervisor/api/users/:username/reset-passkeys`      | Wipe passkeys + issue link (admin recovery) | `supervisor_admin` (not self) + step-up         |
| GET    | `/supervisor/api/users/:username/passkeys`            | List a user's registered passkeys           | admin or self                                   |
| POST   | `/supervisor/api/users/:username/passkeys/:id/delete` | Delete a single passkey                     | admin or self + step-up                         |
| GET    | `/supervisor/api/schemas/`                            | List all supervisor schema names            | (authenticated)                                 |
| GET    | `/supervisor/api/schemas/:name`                       | Get a single JSON Schema                    | (authenticated)                                 |

Login + registration endpoints (`/supervisor/api/auth/...`) are documented in [doc 007](./007-web-auth.md).

## Example AI Agent Workflow

```
1. GET /supervisor/api/
   → Discover _links including "users", "permissions", "schemas"

2. GET /supervisor/api/users
   → List users, see _actions.create and _actions.create-from-agent
      (with disabledReason if caller lacks supervisor_admin)

3. GET /supervisor/api/schemas/CreateUser
   → Learn required fields: username (+ optional stepUpAssertion)

4. POST /supervisor/api/users { "username": "operator", "stepUpAssertion": {...} }
   → 201 { success, id, username, registrationUrl, registrationExpiresAt }

5. Forward registrationUrl to the new user out-of-band.
   → They open it in a browser and register a passkey.

6. GET /supervisor/api/users/operator
   → See detail (hasApiKey, ...), _actions includes update,
     grant-permission, rotate-key, issue-registration, reset-passkeys,
     delete; each permission entry has its own revoke action

7. POST /supervisor/api/users/operator/permissions { "permission": "manage_agents" }
   → 200 { success, message }

8. GET /supervisor/api/users/operator
   → manage_agents now in permissions list with a revoke action
```

## Future Considerations

- Role-based groupings (bundle permissions into named roles)
- Audit log for permission changes (the `grantedBy` + `grantedAt` columns already record each grant; surfacing them in the UI and adding a revoke log would complete the picture)
- Per-user auth-cache invalidation instead of wholesale `authCache.clear()` on every mutation
- More granular permissions as new features land (so far `manage_agents`, `remote_execution`, `manage_hosts`, `agent_communication`, `manage_models`, `manage_variables`, `view_run_logs` have been added beyond the original two)
- Sync permissions across hub for multi-supervisor deployments

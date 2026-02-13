# NAISYS Supervisor - User Management

**Status: Planning**

## Overview

The Supervisor Users page provides user and permission management for the NAISYS Supervisor application. It follows the same AI-first, HATEOAS-driven design philosophy as the ERP module: an AI agent should be able to discover and operate the entire user management system starting from the API root, with the web UI as a thin client over the same REST API.

## Design Philosophy

The supervisor API should be fully discoverable and operable by AI, just like the ERP. The access management endpoints follow the same HATEOAS patterns: `_links` for navigation, `_actions` for state-dependent operations, and schema endpoints for request body discovery.

## Navigation

The supervisor header gains a top-level navigation split between **Main** (the existing agent management views) and **Access** (the new user/permission management). The Access menu item is only visible to users with the `supervisor_admin` permission.

### Header Layout

```
[Logo] NAISYS  Main | Users   [ERP link if enabled]   [API Ref] [Status] [User/Login]
```

- **Main**: Links to `/` (existing home/agent views). The current `AgentNavHeader` tabs (Controls, Runs, Mail) appear as sub-navigation when Main is active.
- **Users**: Links to `/users` (user list). Only shown if the current user has `supervisor_admin` permission.

## Data Model

### Permission Enum

Permissions are defined as a Prisma enum to keep the set of valid permissions constrained and explicit:

```prisma
enum Permission {
  supervisor_admin
  manage_agents
}
```

| Permission         | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `supervisor_admin` | Full access to the Users page (user and permission CRUD)  |
| `manage_agents`    | Ability to create, configure, and control agents           |

New permissions can be added to the enum as the system grows (e.g., `view_logs`, `send_mail`).

### AuthType Enum

The authentication type is stored as a field on the User model (not derived), mirroring the ERP pattern:

```prisma
enum AuthType {
  password
  api_key
}
```

When a user is created via the web UI, they get `password`. When an API-key-based agent from the hub database accesses the supervisor and is auto-provisioned into the local users table, they get `api_key`.

### UserPermission Model

A join table mapping users to their granted permissions:

```prisma
model UserPermission {
  id         Int        @id @default(autoincrement())
  userId     Int        @map("user_id")
  permission Permission
  grantedAt  DateTime   @default(now()) @map("granted_at")
  grantedBy  Int        @map("granted_by")

  user       User       @relation("user_permissions", fields: [userId], references: [id])
  grantor    User       @relation("granted_permissions", fields: [grantedBy], references: [id])

  @@unique([userId, permission])
  @@map("user_permissions")
}
```

The `User` model gains an `authType` field and two reverse relations:

```prisma
model User {
  // ...existing fields...
  authType           AuthType         @default(password) @map("auth_type")
  permissions        UserPermission[] @relation("user_permissions")
  grantedPermissions UserPermission[] @relation("granted_permissions")
}
```

### Admin Bootstrap

When `ensureAdminUser()` creates the initial admin user, it should also grant `supervisor_admin` (and `manage_agents`) permissions to that user. This ensures the first user can access the Users page immediately.

## API Design

**Base path**: `/api/supervisor/users`

All access endpoints require authentication. Endpoints that modify users or permissions additionally require the `supervisor_admin` permission (enforced server-side).

### API Root Discovery

The supervisor API root (`GET /api/supervisor/`) should be updated to include access links:

```json
{
  "_links": [
    { "rel": "users", "href": "/api/supervisor/users", "title": "Users" },
    { "rel": "schemas", "href": "/api/supervisor/schemas/", "title": "Schemas" }
  ],
  "_actions": [
    {
      "rel": "create-user",
      "href": "/api/supervisor/users",
      "method": "POST",
      "title": "Create User",
      "schema": "/api/supervisor/schemas/CreateUser"
    }
  ]
}
```

The `schemas` link is always present (it serves all supervisor schemas). The `users` link and `create-user` action are only included when the authenticated user has `supervisor_admin`.

### Users API

#### List Users

```
GET /api/supervisor/users?page=1&pageSize=20&search=
```

Response:

```json
{
  "items": [
    {
      "id": 1,
      "username": "admin",
      "authType": "password",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "_links": [
        { "rel": "self", "href": "/api/supervisor/users/1" }
      ]
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "_links": [
    { "rel": "self", "href": "/api/supervisor/users?page=1&pageSize=20" },
    { "rel": "first", "href": "/api/supervisor/users?page=1&pageSize=20" },
    { "rel": "last", "href": "/api/supervisor/users?page=1&pageSize=20" }
  ],
  "_actions": [
    {
      "rel": "create",
      "href": "/api/supervisor/users",
      "method": "POST",
      "title": "Create User",
      "schema": "/api/supervisor/schemas/CreateUser"
    }
  ]
}
```

The `authType` field is stored on the User model. Users created via the web UI are `"password"`; agent users auto-provisioned from the hub database are `"api_key"`.

#### Get User Detail

```
GET /api/supervisor/users/:id
```

Response:

```json
{
  "id": 1,
  "username": "admin",
  "authType": "password",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "permissions": [
    {
      "permission": "supervisor_admin",
      "grantedAt": "2025-01-01T00:00:00.000Z",
      "grantedBy": "admin"
    },
    {
      "permission": "manage_agents",
      "grantedAt": "2025-01-01T00:00:00.000Z",
      "grantedBy": "admin"
    }
  ],
  "_links": [
    { "rel": "self", "href": "/api/supervisor/users/1" },
    { "rel": "collection", "href": "/api/supervisor/users" },
    { "rel": "schema", "href": "/api/supervisor/schemas/User" }
  ],
  "_actions": [
    {
      "rel": "update",
      "href": "/api/supervisor/users/1",
      "method": "PUT",
      "title": "Update User",
      "schema": "/api/supervisor/schemas/UpdateUser"
    },
    {
      "rel": "grant-permission",
      "href": "/api/supervisor/users/1/permissions",
      "method": "POST",
      "title": "Grant Permission",
      "schema": "/api/supervisor/schemas/GrantPermission"
    },
    {
      "rel": "delete",
      "href": "/api/supervisor/users/1",
      "method": "DELETE",
      "title": "Delete User"
    }
  ]
}
```

Each permission entry also includes an action to revoke it:

```json
{
  "permission": "manage_agents",
  "grantedAt": "2025-01-01T00:00:00.000Z",
  "grantedBy": "admin",
  "_actions": [
    {
      "rel": "revoke",
      "href": "/api/supervisor/users/1/permissions/manage_agents",
      "method": "DELETE",
      "title": "Revoke Permission"
    }
  ]
}
```

**Self-protection**: Users cannot delete themselves or revoke their own `supervisor_admin` permission (the `delete` and `revoke` actions are omitted from responses for the requesting user's own record).

#### Create User

```
POST /api/supervisor/users
```

```json
{
  "username": "operator",
  "password": "securepassword"
}
```

Response: `201` with the full user detail (same as GET).

#### Update User

```
PUT /api/supervisor/users/:id
```

```json
{
  "username": "new-name",
  "password": "newpassword"
}
```

All fields optional. Password is hashed server-side before storage.

Response: `200` with the full user detail.

#### Delete User

```
DELETE /api/supervisor/users/:id
```

Response: `204 No Content`.

Guard: cannot delete self (409 Conflict).

### Permissions API

#### Grant Permission

```
POST /api/supervisor/users/:userId/permissions
```

```json
{
  "permission": "manage_agents"
}
```

Response: `200` with the updated user detail (includes refreshed permissions and actions).

If the permission is already granted, returns 409 Conflict.

#### Revoke Permission

```
DELETE /api/supervisor/users/:userId/permissions/:permission
```

Response: `200` with the updated user detail.

Guard: cannot revoke own `supervisor_admin` (409 Conflict).

### Schema Endpoints

Following the ERP pattern, schemas are a single top-level endpoint serving all supervisor schemas (not scoped per module). As new supervisor features add schemas, they register with the same catalog.

```
GET /api/supervisor/schemas/          → List all available schema names
GET /api/supervisor/schemas/:name     → Get a single JSON Schema
```

Schemas added by the access module: `CreateUser`, `UpdateUser`, `GrantPermission`, `User`.

## Permission Enforcement

### Server-Side

A `requirePermission` middleware function checks the authenticated user's permissions before allowing access to protected routes:

```typescript
function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.supervisorUser) {
      return reply.status(401).send({ ... });
    }
    const hasPermission = await checkUserPermission(request.supervisorUser.id, permission);
    if (!hasPermission) {
      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: `Requires '${permission}' permission`
      });
    }
  };
}
```

All `/api/supervisor/users/*` routes use `requirePermission("supervisor_admin")`.

The `manage_agents` permission is enforced on agent configuration endpoints (create, update, delete agent config). This is a future enhancement noted here for completeness.

### Client-Side

The `/auth/me` response is extended to include the user's permissions:

```json
{
  "id": 1,
  "username": "admin",
  "permissions": ["supervisor_admin", "manage_agents"]
}
```

The client uses this to conditionally show the Users header tab and to hide UI elements the user lacks permission for.

### Hub API User Auto-Provisioning

When an API-key-based agent from the hub database makes a request to the supervisor, the auth middleware looks up the agent in the hub `users` table. If found and not yet in the local supervisor `users` table, it auto-provisions a local user with `authType: "api_key"` (mirroring the existing SSO auto-provisioning for password users). The auto-provisioned API user does not receive any permissions by default; an admin must grant permissions via the Users page.

### Auth Cache Integration

The existing `AuthCache` caches `SupervisorUser` objects. The `SupervisorUser` interface is extended to include permissions:

```typescript
interface SupervisorUser {
  id: number;
  username: string;
  permissions: string[];
}
```

Permissions are loaded alongside the user during auth middleware resolution and cached together. When permissions change, the affected user's cache entries are invalidated.

## HATEOAS Implementation

### Shared Types

The HATEOAS type definitions (`HateoasLinkSchema`, `HateoasActionSchema`, `HateoasLinksSchema`) are moved from `apps/erp/shared/src/hateoas-types.ts` to `packages/common/src/hateoas-types.ts`. Both the ERP and supervisor import from the common package. The client-side `hasAction` utility also moves to common.

### Server Helpers

A `hateoas.ts` file in the supervisor server provides helper functions following the ERP pattern:

```typescript
const API_PREFIX = "/api/supervisor/users";

function selfLink(path: string): HateoasLink { ... }
function collectionLink(): HateoasLink { ... }
function paginationLinks(...): HateoasLink[] { ... }
function userActions(userId: number, isSelf: boolean): HateoasAction[] { ... }
function permissionActions(userId: number, permission: string, isSelf: boolean): HateoasAction[] { ... }
```

### Response Formatters

Following the ERP `formatItem` / `formatListItem` pattern:

```typescript
function formatUser(user, permissions, requestingUserId) {
  const isSelf = user.id === requestingUserId;
  return {
    id: user.id,
    username: user.username,
    authType: user.authType,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    permissions: permissions.map(p => ({
      permission: p.permission,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantor.username,
      _actions: permissionActions(user.id, p.permission, isSelf),
    })),
    _links: userItemLinks(user.id),
    _actions: userActions(user.id, isSelf),
  };
}

function formatListUser(user) {
  return {
    id: user.id,
    username: user.username,
    authType: user.authType,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    _links: [selfLink(`/users/${user.id}`)],
  };
}
```

## Web UI

### User List Page (`/users`)

Route: `/users`

A paginated table showing all users:

| Column     | Description                      |
| ---------- | -------------------------------- |
| Username   | User's login name                |
| Auth Type  | `password` or `api_key`          |
| Created    | Account creation date            |

Clicking a row navigates to `/users/:id`.

Uses Mantine `Table` with pagination, following the ERP list page patterns.

### User Detail Page (`/users/:id`)

Route: `/users/:id`

Shows user details and an editable permissions section:

- **User info card**: Username, auth type, created/updated dates
- **Edit button**: Opens inline edit for username/password (from `_actions.update`)
- **Permissions section**: List of current permissions with revoke buttons (from each permission's `_actions.revoke`)
- **Grant permission**: A select dropdown + button to grant a new permission (from `_actions.grant-permission`). The dropdown lists permissions that the user does not yet have.
- **Delete button**: Deletes the user (from `_actions.delete`). Hidden for self.

All buttons are conditionally rendered based on `_actions` from the API response, following the ERP pattern with `hasAction()`.

### Client Routing

New routes added to `App.tsx`:

```
/users               → UserList
/users/:id           → UserDetail
```

### API Client

New functions added to the supervisor `apiClient.ts`:

```typescript
getUsers(params)                → GET /users
getUser(id)                     → GET /users/:id
createUser(data)                → POST /users
updateUser(id, data)            → PUT /users/:id
deleteUser(id)                  → DELETE /users/:id
grantPermission(userId, data)   → POST /users/:userId/permissions
revokePermission(userId, perm)  → DELETE /users/:userId/permissions/:perm
```

## File Changes Summary

### New Files

| File | Description |
| ---- | ----------- |
| `apps/supervisor/server/src/routes/users.ts` | Users API routes (users + permissions CRUD) |
| `apps/supervisor/server/src/routes/schemas.ts` | Schema discovery endpoints (top-level, serves all supervisor schemas) |
| `apps/supervisor/server/src/services/userService.ts` | User + permission business logic |
| `apps/supervisor/server/src/hateoas.ts` | HATEOAS helper functions |
| `apps/supervisor/shared/src/user-types.ts` | Zod schemas and types for users API |
| `apps/supervisor/client/src/pages/users/UserList.tsx` | User list page |
| `apps/supervisor/client/src/pages/users/UserDetail.tsx` | User detail page |
| `packages/common/src/hateoas-types.ts` | Shared HATEOAS Zod schemas and types |
| `packages/common/src/hateoas.ts` | Shared client-side `hasAction` utility |

### Modified Files

| File | Change |
| ---- | ------ |
| `apps/supervisor/server/prisma/schema.prisma` | Add `Permission` enum, `UserPermission` model, relations on `User` |
| `apps/supervisor/server/src/routes/api.ts` | Register user routes |
| `apps/supervisor/server/src/auth-middleware.ts` | Extend `SupervisorUser` with permissions, load permissions in auth flow |
| `apps/supervisor/server/src/server.ts` | Add "Access" to swagger tag groups, grant admin permissions in bootstrap |
| `apps/supervisor/shared/src/auth-types.ts` | Add `permissions` to `AuthUserSchema` |
| `apps/supervisor/client/src/App.tsx` | Add Users routes, update header with Main/Users navigation |
| `apps/supervisor/client/src/contexts/SessionContext.tsx` | Expose permissions from auth state |
| `apps/supervisor/client/src/lib/apiClient.ts` | Add users API functions |
| `apps/erp/shared/src/hateoas-types.ts` | Re-export from `@naisys/common` (or update imports) |
| `apps/erp/server/src/hateoas.ts` | Update imports to use common package |
| `apps/erp/client/src/lib/hateoas.ts` | Update imports to use common package |
| `packages/database/src/hubSessionService.ts` | Update `ensureAdminUser` to accept permission grant callback |

## Database Schema

The Prisma schema adds:

1. The `AuthType` enum (`password`, `api_key`)
2. The `Permission` enum (`supervisor_admin`, `manage_agents`)
3. The `authType` field on the `User` model (default: `password`)
4. The `user_permissions` table with columns: `id`, `user_id`, `permission`, `granted_at`, `granted_by`
5. Unique index on `(user_id, permission)`
6. Foreign keys to `users` table

## API Endpoints Summary

| Method | Path | Description | Permission |
| ------ | ---- | ----------- | ---------- |
| GET | `/api/supervisor/users` | List users (paginated) | `supervisor_admin` |
| POST | `/api/supervisor/users` | Create user | `supervisor_admin` |
| GET | `/api/supervisor/users/:id` | Get user detail | `supervisor_admin` |
| PUT | `/api/supervisor/users/:id` | Update user | `supervisor_admin` |
| DELETE | `/api/supervisor/users/:id` | Delete user | `supervisor_admin` |
| POST | `/api/supervisor/users/:id/permissions` | Grant permission | `supervisor_admin` |
| DELETE | `/api/supervisor/users/:id/permissions/:perm` | Revoke permission | `supervisor_admin` |
| GET | `/api/supervisor/schemas/` | List all supervisor schema names | (authenticated) |
| GET | `/api/supervisor/schemas/:name` | Get a single JSON Schema | (authenticated) |

## Example AI Agent Workflow

```
1. GET /api/supervisor/
   → Discover _links including "users" and _actions including "create-user"

2. GET /api/supervisor/users
   → List all users, see pagination links and create action

3. GET /api/supervisor/schemas/CreateUser
   → Learn required fields: username, password

4. POST /api/supervisor/users { "username": "operator", "password": "..." }
   → 201: New user with _actions: [update, grant-permission, delete]

5. GET /api/supervisor/schemas/GrantPermission
   → Learn: { permission: enum["supervisor_admin", "manage_agents"] }

6. POST /api/supervisor/users/2/permissions { "permission": "manage_agents" }
   → 200: Updated user with manage_agents in permissions list

7. GET /api/supervisor/users/2
   → See user detail with permission entries, each with revoke _action
```

## Future Considerations

- Role-based groupings (bundle permissions into named roles)
- Audit log for permission changes
- `manage_agents` permission enforcement on agent config endpoints
- Permission checks on more granular operations (view_logs, send_mail, etc.)
- Sync permissions across hub for multi-supervisor deployments

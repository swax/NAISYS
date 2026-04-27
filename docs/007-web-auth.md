# NAISYS Web Authentication

**Status: Implemented**

## Overview

NAISYS has two web applications — **Supervisor** and **ERP** — that can run independently or co-hosted under the same Fastify server. Both need user authentication, but the design must respect their independence while enabling cross-app session sharing when co-hosted.

## Design Principles

### Each App Owns Its Own Users

- **Supervisor** stores users in its SQLite database (`supervisor.db`, `users` + `sessions` tables, Prisma-managed)
- **ERP** stores users in its Prisma-managed SQLite database (`naisys_erp.db`, `users` + `sessions` tables)
- Each app manages its own user CRUD, password hashing (bcrypt, 10 salt rounds), and seed scripts
- The hub database is only used for agent API key lookups (`findAgentByApiKey`) — not for human web users

This means either app can run fully standalone without depending on the other or on the hub.

### Unified Auth Model

Both apps follow the same authentication pattern:

- **Login**: `POST /{app}/api/auth/login` — username + password, returns user object, sets HTTP-only session cookie. Rate-limited to 5/min.
- **Logout**: `POST /{app}/api/auth/logout` — deletes session record and clears cookie
- **Me**: `GET /{app}/api/auth/me` — returns current authenticated user
- **Session storage**: Dedicated `sessions` table per app — row contains `user_id`, SHA-256 `token_hash`, `expires_at`, `created_at`. The raw UUID token is sent only in the cookie; only the hash is stored.
- **Cookie**: `naisys_session`, `httpOnly: true`, `sameSite: lax`, `secure` in production, 30-day expiry. Defined in `packages/common-node/src/sessionCookie.ts`.

### Auth Middleware

Each app registers a global `onRequest` hook scoped to its API prefix:

- Reads the `naisys_session` cookie, hashes it with SHA-256, looks up the session
- Falls back to `Authorization: Bearer <apiKey>` for machine-to-machine / agent auth
- Decorates `request.supervisorUser` or `request.erpUser`
- Public routes bypass auth (login, API root, schemas, client-config, non-API paths)
- `PUBLIC_READ=true` env var allows unauthenticated GET requests (useful for development and AI agent read access)
- Results cached in-process via `AuthCache<T>` (60s TTL for valid lookups, 10s for negatives)

The ERP middleware only gates `/erp/api` routes; non-ERP paths are treated as public so it doesn't block supervisor routes (and vice versa).

## Current Implementation

### Supervisor Auth

| Component       | Location                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| User table      | `supervisor.db` → `users` (id, username, uuid, is_agent, password_hash, api_key, created_at, updated_at)                   |
| Session table   | `supervisor.db` → `sessions` (id, user_id, token_hash UNIQUE, expires_at, created_at)                                      |
| Permissions     | `supervisor.db` → `user_permissions` (user_id, permission, granted_at, granted_by). `Permission` Prisma enum.              |
| User service    | `apps/supervisor/server/src/services/userService.ts`                                                                       |
| Session service | `packages/supervisor-database/src/sessionService.ts`                                                                       |
| Auth middleware | `apps/supervisor/server/src/auth-middleware.ts`                                                                            |
| Auth routes     | `apps/supervisor/server/src/routes/auth.ts`                                                                                |
| Shared types    | `apps/supervisor/shared/src/auth-types.ts` (LoginRequestSchema, AuthUserSchema, LoginResponseSchema, LogoutResponseSchema) |

### ERP Auth

| Component       | Location                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| User table      | `naisys_erp.db` → `users` (id, uuid UNIQUE, username UNIQUE, password_hash, api_key, is_agent, deleted_at, …) |
| Session table   | `naisys_erp.db` → `sessions` (id, user_id, token_hash UNIQUE, expires_at, created_at)                         |
| Permissions     | `naisys_erp.db` → `user_permissions`. `ErpPermission` enum.                                                   |
| Auth middleware | `apps/erp/server/src/auth-middleware.ts`                                                                      |
| Auth routes     | `apps/erp/server/src/routes/auth.ts`                                                                          |
| SSO flag        | `apps/erp/server/src/supervisorAuth.ts` (`enableSupervisorAuth`, `isSupervisorAuth`)                          |
| Shared types    | `apps/erp/shared/src/auth-types.ts` (LoginRequestSchema, AuthUserSchema, LoginResponseSchema)                 |

### User Schema

Both apps expose the same `AuthUser` shape to clients, extended with permissions:

```typescript
{
  id: number;
  username: string;
  permissions: Permission[] | ErpPermission[];
}
```

Supervisor permissions (Prisma enum): `supervisor_admin`, `manage_agents`, `remote_execution`, `manage_hosts`, `agent_communication`, `manage_models`, `manage_variables`, `view_run_logs`. ERP permissions (Prisma enum): `erp_admin`, `order_planner`, `order_executor`, etc. `*_admin` implies all other permissions in `hasPermission()`.

### API Key Authentication

Both middlewares also accept `Authorization: Bearer <apiKey>` for machine/agent access:

- **Supervisor**: `findUserByApiKey` (supervisor DB) → fallback `findAgentByApiKey` (hub DB). Unknown agents are auto-provisioned into the supervisor `users` table via `createUserForAgent()`.
- **ERP**: In SSO mode, the same supervisor-then-hub lookup; unknown matches are auto-provisioned into the local ERP `users` table with `passwordHash: "!api-key-only"` and `isAgent: true`. In standalone mode, looks up `api_key` on the local ERP user row directly.

## Cross-App Session Sharing (SSO)

### Problem

When supervisor and ERP are co-hosted, a user previously had to log in to each app separately. The apps used different cookies and different user tables, so there was no session portability.

### Solution: Supervisor DB as Session Source of Truth

Both apps read/write the same `naisys_session` cookie. In SSO mode, **supervisor's own `sessions` table** (in `supervisor.db`) is the single source of truth for session tokens — there is no shared hub session table. Both apps import `findSession`, `authenticateAndCreateSession`, `deleteSession` from `@naisys/supervisor-database`. When running standalone, ERP falls back to its local session storage; supervisor always uses its own DB.

#### Single Cookie

Both apps read/write the same `naisys_session` cookie.

#### Enabling SSO Mode

ERP checks `isSupervisorAuth()` at runtime, which is true when either:

1. The supervisor server has called `enableSupervisorAuth()` before registering the ERP plugin (co-hosted case — see `apps/supervisor/server/src/supervisorServer.ts`), or
2. The `SUPERVISOR_AUTH=true` environment variable is set

Supervisor is always in "SSO mode" from its own perspective — it's the canonical store.

#### SSO Mode (Supervisor Available)

On login to ERP, credentials are checked against the supervisor `users` table via `authenticateAndCreateSession()`. On success, a session row is written to `supervisor.db.sessions` and the cookie is set. ERP's local user row is upserted by `uuid` so local permissions can be attached.

On each request, ERP's middleware checks the supervisor `sessions` table. If valid, it resolves (or auto-creates) the local ERP user by `uuid` and loads permissions from the local `user_permissions` table. Logging out from either app deletes the row from `supervisor.db.sessions`, effectively logging the user out of both.

#### Standalone Mode (ERP only)

On login, credentials are checked against the local ERP `users` table and a session row is written to `naisys_erp.db.sessions`. On each request, ERP's middleware checks only the local `sessions` table. No supervisor DB calls occur.

#### Auto-Provisioning

When a valid supervisor session is found but the ERP user doesn't exist locally, the middleware auto-creates it from the supervisor session data (`uuid`, `username`, `passwordHash`). This eliminates the need to seed the same user in both apps. Permissions are NOT copied — they must be granted in each app independently.

#### Auth Middleware Check Order

1. Read `naisys_session` cookie → SHA-256 hash → check `AuthCache`
2. On cache miss:
   - **SSO mode**: `findSession(tokenHash)` against supervisor DB → upsert ERP user by `uuid` → load permissions
   - **Standalone**: query local `sessions` table → load permissions
3. If still unauthenticated, try `Authorization: Bearer` API key (supervisor DB → hub agents → local fallback)
4. Apply public-route and `PUBLIC_READ` rules
5. Otherwise return `401`

### Public Routes

| App        | Public routes                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Supervisor | `/supervisor/api/auth/login`, `/supervisor/api/` (root), anything not under `/supervisor/api`                            |
| ERP        | `/erp/api/auth/login`, `/erp/api/client-config`, `/erp/api/schemas/*`, `/erp/api/` (root), anything not under `/erp/api` |

### Session Service Surface (`@naisys/supervisor-database`)

```
createSupervisorDatabaseClient()         // idempotent init against supervisor.db
findSession(tokenHash)                   // → SessionUser | null (checks expires_at)
lookupUsername(username)                 // → SessionUser | null
findUserByApiKey(apiKey)                 // → { uuid, username } | null
authenticateAndCreateSession(u, pw)      // bcrypt verify → UUID token → sessions row
deleteSession(tokenHash)
updateUserPassword(username, hash)
ensureSuperAdmin(password?)              // bootstrap superadmin user
```

Session tokens are `randomUUID()` values, hashed with SHA-256 (`hashToken()` from `@naisys/common-node`) before storage. The raw token lives only in the cookie; the DB sees only hashes.

## Notes / Non-goals

- No CSRF tokens — relies on `sameSite: lax` and `httpOnly` cookies.
- No session-expiry refresh — sessions are fixed 30-day and require re-login after expiry.
- No password reset, registration, or 2FA routes — user creation is via seed scripts / `ensureSuperAdmin()`.
- ERP permissions are independent per app; granting a role in supervisor does not grant it in ERP.

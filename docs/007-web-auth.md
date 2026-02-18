# NAISYS Web Authentication

**Status: Implemented**

## Overview

NAISYS has two web applications — **Supervisor** and **ERP** — that can run independently or co-hosted under the same Fastify server. Both need user authentication, but the design must respect their independence while enabling cross-app session sharing when co-hosted.

## Design Principles

### Each App Owns Its Own Users

- **Supervisor** stores users in its SQLite database (`supervisor.db`, `users` table)
- **ERP** stores users in its Prisma-managed SQLite database (`naisys_erp.db`, `users` table)
- Each app manages its own user CRUD, password hashing (bcrypt), and seed scripts
- The hub database is not used for web users — it's reserved for agent identities

This means either app can run fully standalone without depending on the other or on the hub.

### Unified Auth Model

Both apps follow the same authentication pattern:

- **Login**: `POST /api/{app}/auth/login` — username + password, returns user object, sets HTTP-only session cookie
- **Logout**: `POST /api/{app}/auth/logout` — clears session from DB and cookie
- **Me**: `GET /api/{app}/auth/me` — returns current authenticated user
- **Session storage**: Token hash + expiry stored on the user row (not in a separate sessions table)
- **Cookie**: `naisys_session`, HTTP-only, `sameSite: lax`, `secure` in production, 30-day expiry

### Auth Middleware

Each app registers a global `onRequest` hook scoped to its API prefix:

- Reads the session cookie, looks up user by token hash
- Decorates `request.supervisorUser` or `request.erpUser`
- Public routes (login, API root, schemas) bypass auth
- `PUBLIC_READ=true` env var allows unauthenticated GET requests (useful for development and AI agent read access)

The ERP middleware only gates `/api/erp` routes, so when co-hosted it doesn't block supervisor routes (and vice versa).

## Current Implementation

### Supervisor Auth

| Component       | Location                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| User table      | `supervisor.db` → `users` (id, username, password_hash, session_token_hash, session_expires_at, created_at, updated_at)    |
| User service    | `apps/supervisor/server/src/services/userService.ts`                                                                       |
| Auth middleware | `apps/supervisor/server/src/auth-middleware.ts`                                                                            |
| Auth routes     | `apps/supervisor/server/src/routes/auth.ts`                                                                                |
| Cookie name     | `naisys_session`                                                                                                           |
| Shared types    | `apps/supervisor/shared/src/auth-types.ts` (LoginRequestSchema, AuthUserSchema, LoginResponseSchema, LogoutResponseSchema) |

### ERP Auth

| Component       | Location                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------- |
| User table      | `naisys_erp.db` → `users` (Prisma-managed, includes uuid, deletedAt for soft-delete)          |
| Auth middleware | `apps/erp/server/src/auth-middleware.ts`                                                      |
| Auth routes     | `apps/erp/server/src/routes/auth.ts`                                                          |
| Cookie name     | `naisys_session`                                                                              |
| Shared types    | `apps/erp/shared/src/auth-types.ts` (LoginRequestSchema, AuthUserSchema, LoginResponseSchema) |

### User Schema

Both apps share the same `AuthUser` shape exposed to clients:

```typescript
{
  id: number;
  username: string;
}
```

## Cross-App Session Sharing (SSO)

### Problem

When supervisor and ERP are co-hosted, a user previously had to log in to each app separately. The apps used different cookies (`supervisor_session` vs `erp_session`) and different user tables, so there was no session portability.

### Solution: Hub `supervisor_users` Table

Both apps share a single cookie name (`naisys_session`). When the hub database is available (SSO mode), the hub `supervisor_users` table is the **single source of truth** for session tokens. When running standalone, each app falls back to local session storage.

#### Single Cookie

Both apps read/write the same `naisys_session` cookie, replacing the old per-app cookies.

#### SSO Mode (Hub Available)

On login, the session token is written **only** to the hub `supervisor_users` table. The local user table's session field is set to `!sso` as a placeholder (not a real token). The hub user record is upserted (created or updated) with credentials and session data.

On each request, the middleware checks **only** the hub for the session token. If valid, it resolves (or auto-provisions) the local user by `uuid`. Logging out from either app clears the hub session token (the user record persists), effectively logging the user out of both apps.

On login, if the user doesn't exist locally but exists in the hub `supervisor_users` table, the app auto-provisions a local user from the hub credentials.

#### Standalone Mode (No Hub)

On login, the session token is written to the local user table. On each request, the middleware checks only the local user table. No hub interaction occurs — all hub session functions are no-ops.

#### Auto-Provisioning

The hub user record carries `username`, `password_hash`, and `uuid`. Auto-provisioning happens in two places:

1. **Auth middleware**: When a valid hub session is found, the middleware resolves the local user by `uuid`. If the user doesn't exist locally, it's auto-created from the hub data.
2. **Login route**: When a user enters credentials that don't match any local user, the app checks the hub `supervisor_users` table by username. If found and the password matches, the user is auto-provisioned locally and logged in.

This eliminates the need to seed the same user in both apps.

#### Auth Middleware Check Order

1. Read `naisys_session` cookie → hash it
2. If hub available → check hub `supervisor_users` by session token → resolve local user by `uuid` (or auto-create)
3. If hub not available → check local user table by token hash
4. Apply existing auth rules (public routes, `PUBLIC_READ`, etc.)

#### Hub `supervisor_users` Schema

```
supervisor_users (uuid UNIQUE, username UNIQUE, password_hash, session_token_hash, session_expires_at, created_at, updated_at)
```

- User records persist across login/logout cycles — only the session token is cleared on logout
- Both apps access via `@naisys/database` shared hub session service (`initHubSessions`, `isHubAvailable`, `findHubSession`, `findHubUserByUsername`, `createHubSession`, `deleteHubSession`)
- `initHubSessions()` is idempotent — safe to call from both apps when co-hosted (shared module instance)

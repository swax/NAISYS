# NAISYS Web Authentication

**Status: In Progress**

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
- **Cookie**: HTTP-only, `sameSite: lax`, `secure` in production, 30-day expiry

### Auth Middleware

Each app registers a global `onRequest` hook scoped to its API prefix:

- Reads the session cookie, looks up user by token hash
- Decorates `request.supervisorUser` or `request.erpUser`
- Public routes (login, API root, schemas) bypass auth
- `PUBLIC_READ=true` env var allows unauthenticated GET requests (useful for development and AI agent read access)

The ERP middleware only gates `/api/erp` routes, so when co-hosted it doesn't block supervisor routes (and vice versa).

## Current Implementation

### Supervisor Auth

| Component | Location |
| --- | --- |
| User table | `supervisor.db` → `users` (id, username, password_hash, session_token_hash, session_expires_at, created_at, updated_at) |
| User service | `apps/supervisor/server/src/services/userService.ts` |
| Auth middleware | `apps/supervisor/server/src/auth-middleware.ts` |
| Auth routes | `apps/supervisor/server/src/routes/auth.ts` |
| Seed script | `apps/supervisor/server/src/seed.ts` (`npm run db:seed`) |
| Cookie name | `supervisor_session` |
| Shared types | `apps/supervisor/shared/src/auth-types.ts` (LoginRequestSchema, AuthUserSchema, LoginResponseSchema, LogoutResponseSchema) |

### ERP Auth

| Component | Location |
| --- | --- |
| User table | `naisys_erp.db` → `users` (Prisma-managed, includes uuid, deletedAt for soft-delete) |
| Auth middleware | `apps/erp/server/src/auth-middleware.ts` |
| Auth routes | `apps/erp/server/src/routes/auth.ts` |
| Seed script | `apps/erp/server/prisma/seed.ts` (`npm run db:seed`) |
| Cookie name | `erp_session` |
| Shared types | `apps/erp/shared/src/auth-types.ts` (LoginRequestSchema, AuthUserSchema, LoginResponseSchema) |

### User Schema

Both apps share the same `AuthUser` shape exposed to clients:

```typescript
{
  id: number;
  username: string;
}
```

## Future: Cross-App Session Sharing

### Problem

When supervisor and ERP are co-hosted, a user must log in to each app separately. The apps use different cookies (`supervisor_session` vs `erp_session`) and different user tables, so there's no session portability.

### Planned Solution: Common `web_auth` Table in Hub DB

Since the hub database (`@naisys/database`) is available to both apps when co-hosted, we plan to use a shared `web_auth` table there for cross-app token storage:

- On login to either app, write a session record to `web_auth` in the hub DB
- Both auth middlewares check the hub `web_auth` table in addition to their local user table
- The hub table maps a token hash → app-specific user identity, so each app can resolve the session to its own user row
- When running standalone (no hub), fall back to local-only auth (current behavior)

This gives us single sign-on across supervisor and ERP without polluting the hub's agent user table, and without requiring either app to know about the other's user schema.

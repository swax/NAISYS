# NAISYS Web Authentication

**Status: Implemented**

## Overview

NAISYS has two web applications — **Supervisor** and **ERP** — that can run independently or co-hosted under the same Fastify server. Both need user authentication, but the design respects their independence while enabling cross-app session sharing when co-hosted.

Supervisor login is **passkey-only** (WebAuthn). New accounts are bootstrapped through one-time **registration links** rather than admin-set credentials. Sensitive admin actions are gated by **step-up auth** that re-proves credential possession on the live session. ERP keeps the legacy username + password flow for standalone deployments; in SSO mode it inherits whatever passkey session the operator established in Supervisor.

## Design Principles

### Each App Owns Its Own Users

- **Supervisor** stores users in its SQLite database (`supervisor.db`, `users` + `sessions` + `passkey_credentials` + `registration_tokens` tables, Prisma-managed)
- **ERP** stores users in its Prisma-managed SQLite database (`naisys_erp.db`, `users` + `sessions` tables)
- Each app manages its own user CRUD and seed scripts. Supervisor handles passkey credentials and registration tokens; ERP keeps its standalone bcrypt password path.
- The hub database is only used for agent API key lookups (`findAgentByApiKey`) — not for human web users.

Either app can run fully standalone without depending on the other or on the hub.

### Unified Session Model

Both apps share the same session-cookie shape and middleware shape, even though their login flows differ:

- **Logout**: `POST /{app}/api/auth/logout` — deletes the session row and clears the cookie
- **Me**: `GET /{app}/api/auth/me` — returns the current authenticated user
- **Session storage**: Dedicated `sessions` table per app — row contains `user_id`, SHA-256 `token_hash`, `expires_at`, `created_at`. The raw UUID token is sent only in the cookie; only the hash is stored.
- **Cookie**: `naisys_session`, `httpOnly: true`, `sameSite: lax`, `secure` in production, 30-day expiry. Defined in `packages/common-node/src/sessionCookie.ts`.

### Auth Middleware

Each app registers a global `onRequest` hook scoped to its API prefix:

- Reads the `naisys_session` cookie, hashes it with SHA-256, looks up the session
- Falls back to `Authorization: Bearer <apiKey>` for machine-to-machine / agent auth
- Decorates `request.supervisorUser` or `request.erpUser`
- Public routes bypass auth (login/register endpoints, registration-token lookup, API root, schemas, client-config, non-API paths)
- `PUBLIC_READ=true` env var allows unauthenticated GET requests (useful for development and AI agent read access)
- Results cached in-process via `AuthCache<T>` (60s TTL for valid lookups, 10s for negatives)

The ERP middleware only gates `/erp/api` routes; non-ERP paths are treated as public so it doesn't block supervisor routes (and vice versa).

### Reverse-Proxy Awareness

All three Fastify instances (hub, supervisor, ERP) set `trustProxy: true`. Behind a TLS-terminating reverse proxy, this makes `request.protocol` honor the `X-Forwarded-Proto` header so registration URLs and the WebAuthn origin come out as `https://` rather than the internal `http://` hop. If you can't trust your proxy (rare in self-hosted setups), pin the relying-party identity instead via `SUPERVISOR_WEBAUTHN_ORIGIN` / `SUPERVISOR_WEBAUTHN_RP_ID` (see _Configuration_).

## Supervisor Auth Flows

### Passkey Login

WebAuthn / `@simplewebauthn` with usernameless, discoverable credentials and required user verification (biometric or PIN gesture every time). The flow is split into options + verify so a server-issued challenge protects each ceremony:

1. `POST /supervisor/api/auth/passkey/login-options` → server returns assertion options and sets `naisys_passkey_auth_chal` (httpOnly, 5-min, scoped to `/supervisor/api/auth/passkey/`).
2. Browser runs `navigator.credentials.get()`.
3. `POST /supervisor/api/auth/passkey/login-verify` with the assertion. Server reads the challenge cookie, verifies, advances the credential's signature counter, mints a session, and sets the `naisys_session` cookie.

`allowCredentials: []` lets the browser show every discoverable passkey for the RP — no username needed at the prompt. `userVerification: "required"` is set on both registration and authentication so a stolen device can't silently assert.

### Registration Tokens

Accounts never start with a credential. Admins (and the bootstrap flow) issue a one-time **registration token** that the operator opens in their browser to enroll their first passkey.

```
POST /supervisor/api/users                                   → creates user, returns registrationUrl
POST /supervisor/api/users/:username/registration-token      → re-issues a token (admin or self)
POST /supervisor/api/users/:username/reset-passkeys          → wipes all passkeys + issues a fresh token (admin)
GET  /supervisor/api/auth/registration-token/lookup?token=…  → validates a token, returns the username
```

Tokens are 32 random bytes, hex-encoded, stored as SHA-256 hashes in `registration_tokens`, with a 7-day TTL and a `usedAt` field. Issuing a new token deletes any prior unused tokens for that user.

The registration page (`/supervisor/register?token=…`) calls the lookup endpoint, then drives a passkey enrollment ceremony via `POST /auth/passkey/register-options` → WebAuthn → `POST /auth/passkey/register-verify`. The verify step **consumes the token and stores the credential atomically in a single transaction** — either both happen or neither does — closing the race where two parallel requests carrying the same one-time token could otherwise each enroll a credential. On success the user is signed in immediately (session minted, cookie set).

### Adding More Credentials Later

A signed-in user can add another passkey from the user-detail page without a registration token — but only if they already have at least one passkey on file (and step-up succeeds). First-passkey enrollment from an authenticated session is _forbidden_; that case must come through an admin-issued registration link, otherwise a hijacked session on a fresh account could mint the first credential without proving the legitimate human is present.

To enroll on a different device, the user calls `POST /users/:self/registration-token` and uses the returned URL on that device. Self-issuance also requires step-up.

### QR Code for Registration Links

When a registration link is issued through the UI, the result panel shows the URL alongside a QR code (rendered SVG via `qrcode.react`, level M, 160×160 with a white quiet-zone wrapper for dark-mode contrast). Pointing a phone camera at the QR opens the registration page on that device — useful for inviting users or enrolling a second device.

The QR is suppressed when the link points at a loopback host (`localhost`, `127.x`, `::1`, `0.0.0.0`); a phone camera scanning that QR would just dial the phone itself. A small note suggests setting `SUPERVISOR_WEBAUTHN_ORIGIN` to a LAN-reachable URL when QR enrollment from another device is needed. The copy button is always available regardless of host.

### Step-Up Auth

Sensitive endpoints — issuing a registration link, deleting a passkey, wiping all passkeys, creating a user — re-prove credential possession on the live session before they run. This defends against session-cookie hijack: a stolen cookie alone can't drain credentials or mint replacement registration links.

Server side (`apps/supervisor/server/src/services/stepUpService.ts`):

```typescript
requireStepUp(request, reply, body): Promise<{ ok: true } | { ok: false; status; message }>
```

Rules:

1. **Caller has a passkey** → require a fresh WebAuthn assertion in `body.stepUpAssertion`. Verifier advances the credential's signature counter so the same assertion can't be replayed against another step-up attempt.
2. **No passkey on file** → bypass step-up. The alternative would lock recovery sessions out (a bootstrap superadmin who has lost all credentials still needs a way back in). Endpoints that create new credentials add their own state guards on top of this — see below.

Replay safety: the passkey path is replay-proof per call because the challenge cookie is single-use and the signature counter advances on every verify.

Client side (`apps/supervisor/client/src/lib/apiAuth.ts`):

- `performStepUp()` — fetches `POST /auth/passkey/stepup-options`, runs the WebAuthn assertion ceremony, returns the body shape the server expects.
- `postWithStepUp(endpoint)` — wraps a sensitive POST: runs step-up, sends the proof in the body.

### Self-Action State Guards

Beyond step-up, a few endpoints have additional state guards:

- **`POST /users/:username/passkeys/:id/delete`** — after delete, sessions for that user are revoked. The actor's own current session is preserved only if they still have a passkey; otherwise their cookie is cleared client-side too. Without this, an attacker holding a stolen cookie could drain a victim's passkeys to zero — `requireStepUp` then bypasses on the empty set, letting them mint a registration link and enroll their own credential.
- **`POST /users/:username/registration-token`** (self) — refuses self-issuance when the caller has no passkey. The legitimate path in that case is an admin-issued link.

### API Key Authentication

Both middlewares accept `Authorization: Bearer <apiKey>` for machine/agent access:

- **Supervisor**: `findUserByApiKey` (supervisor DB) → fallback `findAgentByApiKey` (hub DB). Unknown agents are auto-provisioned into the supervisor `users` table via `createUserForAgent()` with no passkeys.
- **ERP**: In SSO mode, the same supervisor-then-hub lookup; unknown matches are auto-provisioned into the local ERP `users` table with `passwordHash: "!api-key-only"` and `isAgent: true`. In standalone mode, looks up `api_key` on the local ERP user row directly.

## Database Schema (Supervisor)

```prisma
model User {
  id                  Int                 @id @default(autoincrement())
  username            String              @unique
  uuid                String              @default("")
  isAgent             Boolean             @default(false)
  apiKey              String?             @unique
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  permissions         UserPermission[]
  sessions            Session[]
  passkeyCredentials  PasskeyCredential[]
  registrationTokens  RegistrationToken[]
}

model Session {
  id        Int      @id @default(autoincrement())
  userId    Int
  tokenHash String   @unique     // SHA-256 of the session UUID in the cookie
  expiresAt DateTime              // 30 days
  createdAt DateTime @default(now())
}

model PasskeyCredential {
  id           Int       @id @default(autoincrement())
  userId       Int
  credentialId String    @unique
  publicKey    String                       // base64url, isoBase64URL.fromBuffer
  counter      Int       @default(0)        // signature counter, advanced on each verify
  transports   String    @default("")       // comma-joined AuthenticatorTransports
  deviceLabel  String    @default("")       // user-supplied or UA-derived
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime?
}

model RegistrationToken {
  id        Int       @id @default(autoincrement())
  userId    Int
  tokenHash String    @unique     // SHA-256 of the plaintext token in the URL
  expiresAt DateTime              // 7 days
  usedAt    DateTime?             // null until consumed
  createdAt DateTime  @default(now())
}
```

## Endpoint Surface (Supervisor)

| Method | Path                                                     | Purpose                                        | Auth                       |
| ------ | -------------------------------------------------------- | ---------------------------------------------- | -------------------------- |
| POST   | `/supervisor/api/auth/passkey/login-options`             | Begin WebAuthn login (issues challenge cookie) | public                     |
| POST   | `/supervisor/api/auth/passkey/login-verify`              | Complete WebAuthn login → session              | public                     |
| POST   | `/supervisor/api/auth/passkey/stepup-options`            | Begin step-up assertion ceremony               | session                    |
| POST   | `/supervisor/api/auth/passkey/register-options`          | Begin passkey registration (token or step-up)  | token _or_ session+step-up |
| POST   | `/supervisor/api/auth/passkey/register-verify`           | Complete passkey registration                  | token _or_ session         |
| GET    | `/supervisor/api/auth/registration-token/lookup?token=…` | Validate a registration token, return username | public                     |
| POST   | `/supervisor/api/auth/logout`                            | Delete session, clear cookie                   | (any)                      |
| GET    | `/supervisor/api/auth/me`                                | Current authenticated user                     | session                    |
| GET    | `/supervisor/api/users/:username/passkeys`               | List a user's passkeys                         | admin or self              |
| POST   | `/supervisor/api/users/:username/passkeys/:id/delete`    | Delete a passkey (POST so step-up body fits)   | admin or self + step-up    |
| POST   | `/supervisor/api/users/:username/registration-token`     | Issue a one-time registration link             | admin or self + step-up    |
| POST   | `/supervisor/api/users/:username/reset-passkeys`         | Wipe all passkeys + issue a fresh link         | admin (not self) + step-up |

Login + register endpoints are rate-limited per IP (10–30/min depending on shape); 429 is documented in each endpoint's response schema.

## Operator Setup & Recovery

`bootstrapSupervisor()` (`apps/supervisor/server/src/supervisorServer.ts`) runs before the plugin registers and:

1. Deploys migrations and connects to `supervisor.db`.
2. Calls `ensureSuperAdmin()` — creates the `superadmin` user with `supervisor_admin` if missing. **No credential is set.**
3. If `--setup` was passed, asks whether to wipe the superadmin's passkeys + sessions.
4. Issues a registration link if any of: just bootstrapped, operator asked to reset, or the superadmin has no passkey and no unexpired token. Prints the URL to stdout and waits on TTY for the operator to acknowledge.

The reset prompt's default flips based on context: explicit `--setup` runs default to "no" (so tweaking env vars doesn't lock you out), while implicit first-run setup defaults to "yes" (so the operator gets a fresh link without typing `y`). If a reset is performed, sessions are also wiped so an old browser cookie can't outlive the credential it was minted from.

The printed URL uses `SUPERVISOR_WEBAUTHN_ORIGIN` when set so it lands on a host the browser will accept; otherwise it falls back to `http://localhost:<SERVER_PORT>`.

If you're locked out, restart the supervisor with `--setup` to re-issue a superadmin registration link. The login page surfaces this hint behind a "Trouble signing in?" link.

## Configuration

```
# Optional WebAuthn hardening — when unset, RP ID and origin derive from request
# headers (fine for dev; requires trusting your reverse proxy in production).
# Set these to lock the relying-party identity to fixed values regardless of
# Host/Origin headers.
SUPERVISOR_WEBAUTHN_RP_ID=supervisor.example.com
SUPERVISOR_WEBAUTHN_ORIGIN=https://supervisor.example.com   # or comma-list for multi-origin
```

`SUPERVISOR_WEBAUTHN_RP_ID` must be a domain (or `localhost`) with no port. `SUPERVISOR_WEBAUTHN_ORIGIN` is a full origin URL; a comma-separated list is supported for the rare case where one deploy accepts assertions from more than one origin. The first entry is treated as canonical when building registration URLs.

## Developing Across Devices (dev/phone)

Browsers won't run WebAuthn over plain `http://` to a non-`localhost` host, and a phone scanning a QR code that points at `localhost` won't reach your dev box. The standard answer is to front the supervisor with a tunneling service that gives you a stable HTTPS origin:

```bash
cloudflared tunnel --url http://localhost:3301        # or `ngrok http 3301`
# Set on the supervisor:
SUPERVISOR_WEBAUTHN_ORIGIN=https://<tunnel-host>
```

The tunnel host becomes the WebAuthn relying-party origin, so registrations and assertions both work from any device that can resolve it. Without this, dev passkey testing is restricted to the same machine the server runs on.

## ERP Auth (legacy password)

ERP retains the username + password flow via bcrypt:

| Component       | Location                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| User table      | `naisys_erp.db` → `users` (id, uuid UNIQUE, username UNIQUE, password_hash, api_key, is_agent, deleted_at, …) |
| Session table   | `naisys_erp.db` → `sessions` (id, user_id, token_hash UNIQUE, expires_at, created_at)                         |
| Permissions     | `naisys_erp.db` → `user_permissions`. `ErpPermission` enum.                                                   |
| Auth middleware | `apps/erp/server/src/auth-middleware.ts`                                                                      |
| Auth routes     | `apps/erp/server/src/routes/auth.ts`                                                                          |
| SSO flag        | `apps/erp/server/src/supervisorAuth.ts` (`enableSupervisorAuth`, `isSupervisorAuth`)                          |
| Shared types    | `apps/erp/shared/src/auth-types.ts` (LoginRequestSchema, AuthUserSchema, LoginResponseSchema)                 |

Both apps expose the same `AuthUser` shape to clients:

```typescript
{
  id: number;
  username: string;
  permissions: Permission[] | ErpPermission[];
}
```

Supervisor permissions: `supervisor_admin`, `manage_agents`, `remote_execution`, `manage_hosts`, `agent_communication`, `manage_models`, `manage_variables`, `view_run_logs`. ERP permissions: `erp_admin`, `order_planner`, `order_executor`, etc. `*_admin` implies all other permissions in `hasPermission()`.

## Cross-App Session Sharing (SSO)

### Problem

When supervisor and ERP are co-hosted, a user previously had to log in to each app separately. The apps used different cookies and different user tables, so there was no session portability.

### Solution: Supervisor DB as Session Source of Truth

Both apps read/write the same `naisys_session` cookie. In SSO mode, **supervisor's own `sessions` table** (in `supervisor.db`) is the single source of truth for session tokens — there is no shared hub session table. ERP imports `findSession` and `findUserByApiKey` from `@naisys/supervisor-database`. When running standalone, ERP falls back to its local session storage and its local password-based login route; supervisor always uses its own DB and its own passkey routes.

#### Enabling SSO Mode

ERP checks `isSupervisorAuth()` at runtime, which is true when either:

1. The supervisor server has called `enableSupervisorAuth()` before registering the ERP plugin (co-hosted case — see `apps/supervisor/server/src/supervisorServer.ts`), or
2. The `SUPERVISOR_AUTH=true` environment variable is set

Supervisor is always in "SSO mode" from its own perspective — it's the canonical store.

#### SSO Mode (Supervisor Available)

Login happens in the Supervisor app via passkey — there is no separate ERP login UI when SSO is on. The supervisor mints a session row in `supervisor.db.sessions` and sets the cookie.

On each ERP request, ERP's middleware looks the session up in the supervisor table. If valid, it resolves (or auto-creates) the local ERP user by `uuid` and loads permissions from the local `user_permissions` table. Logging out from either app deletes the row from `supervisor.db.sessions`, effectively logging the user out of both.

#### Standalone Mode (ERP only)

On login, credentials are checked against the local ERP `users` table and a session row is written to `naisys_erp.db.sessions`. On each request, ERP's middleware checks only the local `sessions` table. No supervisor DB calls occur.

#### Auto-Provisioning

When a valid supervisor session is found but the ERP user doesn't exist locally, the middleware auto-creates it from the supervisor session data (`uuid`, `username`) with `passwordHash: "!sso-passkey-only"` as a sentinel. ERP never authenticates that user with a password — login authority lives entirely in Supervisor. Permissions are NOT copied — they must be granted in each app independently.

#### Auth Middleware Check Order

1. Read `naisys_session` cookie → SHA-256 hash → check `AuthCache`
2. On cache miss:
   - **SSO mode**: `findSession(tokenHash)` against supervisor DB → upsert ERP user by `uuid` → load permissions
   - **Standalone**: query local `sessions` table → load permissions
3. If still unauthenticated, try `Authorization: Bearer` API key (supervisor DB → hub agents → local fallback)
4. Apply public-route and `PUBLIC_READ` rules
5. Otherwise return `401`

### Public Routes

| App        | Public routes                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supervisor | `/supervisor/api/auth/passkey/{login,register}-{options,verify}`, `/supervisor/api/auth/registration-token/lookup`, `/supervisor/api/` (root), anything not under `/supervisor/api` |
| ERP        | `/erp/api/auth/login`, `/erp/api/client-config`, `/erp/api/schemas/*`, `/erp/api/` (root), anything not under `/erp/api`                                                            |

### Supervisor Database Surface (`@naisys/supervisor-database`)

```
createSupervisorDatabaseClient()         // idempotent init against supervisor.db
findSession(tokenHash)                   // → SessionUser | null (checks expires_at)
findUserByApiKey(apiKey)                 // → { uuid, username } | null
createSessionForUser(userId)             // → { token, expiresAt, user } — caller sets the cookie
deleteSession(tokenHash)
deleteAllSessionsForUser(userId, exceptTokenHash?)
ensureSuperAdmin()                       // bootstrap superadmin user (no credentials)

// Passkeys
createPasskeyCredential(...)
findPasskeyCredentialByCredentialId(credentialId)
listPasskeyCredentialsForUser(userId)
listPasskeyCredentialIdsForUser(userId)
updatePasskeyCounter(credentialId, counter)
deletePasskeyCredential(id, userId)
deleteAllPasskeyCredentialsForUser(userId)
userHasPasskey(userId)

// Registration tokens
issueRegistrationToken(userId)           // → { token, expiresAt }; revokes prior unused tokens
lookupRegistrationToken(token)           // non-consuming
hasActiveRegistrationToken(userId)
consumeTokenAndStoreCredential({...})    // atomic consume + passkey insert
```

Session tokens are `randomUUID()` values, hashed with SHA-256 (`hashToken()` from `@naisys/common-node`) before storage. Registration tokens are 32 random bytes, hex-encoded, also hashed before storage. Passkey credentials store the WebAuthn public key base64url-encoded and a signature counter that's advanced on every successful authentication.

## Considered Alternatives

### Optional password fallback (rejected)

A version that added an opt-in password login path alongside passkeys was prototyped and lives on the `password-fallback` branch — `ALLOW_PASSWORD_LOGIN=true` exposed `/auth/password/{login,register,verify}` plus a password fallback through step-up. It was rolled back before merge.

The deciding argument was that a passkey-and-password account has the security of `max(passkey_strength, password_strength)` from the attacker's side — they pick the easier path. A user who picks a weak password downgrades their entire account to password-tier security and the passkey becomes decorative. Mitigations like length floors / zxcvbn / HIBP push the floor up but don't change the shape of the problem; they're new code to maintain for an outcome that contradicts the reason passkeys were adopted.

The recovery cases that motivated a fallback have better answers:

- **Different device with no enrolled passkey** — use the WebAuthn cross-device flow (browser shows its own QR; phone authenticates over Bluetooth proximity), or enroll a second passkey on each device the user actually uses.
- **All devices lost** — admin re-issues a registration link; lone-admin lockout is recovered via `--setup` on the server.
- **Future: self-service recovery without admin** — if and when this becomes a real need, the cleaner option than passwords is **email-based registration links**: the user enters their email, the server emails them a fresh registration token. Email security becomes the dependency (universally trusted as the recovery channel), no per-account weak-credential floor. NAISYS doesn't have email infrastructure today; building it is the work to do _then_, not now.

The `password-fallback` branch is preserved for reference. If email recovery ever lands, some of the structural changes (step-up `method` discriminator, atomic `consume-token-and-set-credential`) may be useful to cherry-pick.

## Notes / Non-goals

- No CSRF tokens — relies on `sameSite: lax` and `httpOnly` cookies.
- No session-expiry refresh — sessions are fixed 30-day and require re-login after expiry.
- No password reset / username-password recovery for supervisor — operators issue a fresh registration link instead. Lone-admin lockout is recovered through `--setup` on the server.
- ERP UI does not yet expose passkey enrollment. In SSO mode users register passkeys in Supervisor and the cookie carries them into ERP; in standalone mode ERP keeps username + password.
- ERP permissions are independent per app; granting a role in supervisor does not grant it in ERP.

# NAISYS Supervisor

[← Back to main README](../../README.md)

The supervisor is the web UI for monitoring and managing a NAISYS cluster. It connects to the hub over WebSocket for live updates on agents, runs, mail, and hosts, and exposes a permission-aware REST API that agents themselves can call (via `ns-api`) thanks to HATEOAS action gating.

## Running

Most groups run the supervisor inside the integrated stack — see the [main README](../../README.md). Startup prints the local Supervisor URL; open it to create agents, invite users, assign permissions, add hosts, pin agents, inspect live consoles, review runs, and track model costs.

To run it alone against an existing hub:

```bash
npm install @naisys/supervisor
npx naisys-supervisor
```

> **Note:** Remote auto-update from the supervisor UI only works when the supervisor runs attached to a `naisys` runner (the integrated stack). Running `naisys-supervisor` solo skips the runner that performs the update.

## Configuration

Standalone supervisor reads configuration from `.env`:

- `NAISYS_FOLDER` - persistent data folder shared with the hub databases and logs
- `HUB_URL` - hub URL, usually `http://localhost:3300/hub` or `https://<server>/hub`
- `SERVER_PORT` - HTTP port; defaults to `3301`
- `PUBLIC_READ` - optional read-only public access mode

## Features

### Pages

- **Agents** — list + detail page with live config, controls, archive/delete, start/stop, host assignment, initial commands, create/edit in UI, yaml import, model/template-variable selects, config revision history
- **Runs** — paging, run sessions grouped by session, real-time logs with attachments, fold-out console, image previews, image gallery for computer-use runs
- **Mail** — two-panel design with chat UI, read/delivered status, attachment send, archive-all, paging, from-title
- **Hosts** — CRUD, agent assignment, recent runs, last-known IP, environment info, remote hostname change
- **Cost analysis** — graphs and a model cost calculator (Chart.js)
- **Admin** — system info/config, DB sizes, app/DB version, error-filtered logs
- **Variables** — sensitive-value hiding, read-only mode
- **Users & permissions** ([doc 008](../../docs/008-supervisor-users.md)) — CRUD, permission management, create-user-from-agent, registration-link issuance with QR code, passkey list/delete/reset, API keys with rotation
- **API reference** — Scalar UI gated behind auth; OpenAPI spec hidden from agents

### UX

- Socket-based live updates for agents, hosts, mail, chat, status (no polling)
- Permission-aware UI via HATEOAS action gating — buttons hide when the action isn't allowed
- Error boundaries and toast notifications via a global error handler
- Responsive layouts with collapsible sidebar; widescreen tweaks
- Person/agent icons to visually separate humans from agents
- Agent model icon in the nav header
- PWA detection with refresh prompt

### Agent-facing / HATEOAS ([doc 012](../../docs/012-hateoas.md))

- Permission system with HATEOAS actions gating both UI and API (`permGate`)
- Disabled-action states include a reason so agents know why they can't act
- Backward pagination (`prev` links) symmetric with forward pagination
- Agent API keys for calling ERP/supervisor APIs from agents

### Auth ([doc 007](../../docs/007-web-auth.md))

- Passkey-only supervisor login (WebAuthn, usernameless, required user verification)
- One-time registration links for new accounts; QR code in the UI for phone enrollment
- Step-up auth on sensitive actions (issue registration link, delete passkey, reset passkeys, create user) re-proves credential possession
- Sessions table with multi-session support; cookie sharing between co-hosted supervisor + ERP
- Logout, rate limiting, secure cookies in production
- Bootstrap superadmin via printed registration URL on first run; `--setup` re-issues a fresh link if locked out
- Read-only mode for variables/users

### Supervising running agents

- Send `pause` to a live agent
- Send a debug command to a live agent
- Live command-loop state from the runner

## Architecture

Full-stack TypeScript:

- **client/** — React + Mantine frontend
- **server/** — Fastify backend
- **shared/** — shared types and Zod schemas

Data lives in the hub ([apps/hub](../hub/README.md)); the supervisor is a thin UI + API layer on top.

## License

MIT

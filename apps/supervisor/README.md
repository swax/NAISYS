# NAISYS Supervisor

[← Back to main README](../../README.md)

The supervisor is the web UI for monitoring and managing a NAISYS cluster. It connects to the hub over WebSocket for live updates on agents, runs, mail, and hosts, and exposes a permission-aware REST API that agents themselves can call (via `ns-api`) thanks to HATEOAS action gating.

Run standalone with `npx naisys_supervisor`, or in-process with `npx naisys --supervisor`.

## Features

### Pages

- **Agents** — list + detail page with live config, controls, archive/delete, start/stop, host assignment, initial commands, create/edit in UI, yaml import, model/template-variable selects, config revision history
- **Runs** — paging, run sessions grouped by session, real-time logs with attachments, fold-out console, image previews, image gallery for computer-use runs
- **Mail** — two-panel design with chat UI, read/delivered status, attachment send, archive-all, paging, from-title
- **Hosts** — CRUD, agent assignment, recent runs, last-known IP, environment info, remote hostname change
- **Cost analysis** — graphs and a model cost calculator (Chart.js)
- **Admin** — system info/config, DB sizes, app/DB version, error-filtered logs
- **Variables** — sensitive-value hiding, read-only mode
- **Users & permissions** ([doc 008](../../docs/008-supervisor-users.md)) — CRUD, permission management, create-user-from-agent, password reset, API keys with rotation
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

- Username/password auth with bcryptjs
- Sessions table with multi-session support; cookie sharing between co-hosted supervisor + ERP
- Login/logout, rate limiting, secure cookies in production
- Password reset from CLI
- Forced setup of the superadmin password at first run, logged for acknowledgement
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

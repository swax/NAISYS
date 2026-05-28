# @naisys/supervisor-client

[← Back to Supervisor](../README.md) | [← Back to main README](../../../README.md)

React + Vite frontend for the NAISYS Supervisor. Internal to the monorepo — at build time it's bundled into [`@naisys/supervisor`](../README.md) and served by the Fastify server.

## Running

Dev mode:

```bash
npm run dev --workspace=@naisys/supervisor-client
```

Vite proxies API calls to the supervisor server.

## Structure

- **`pages/`** — top-level routes (agents, runs, mail, hosts, cost, admin, variables, users)
- **`nav/`** — sidebar, header, agent/model badges
- **`components/`** — reusable UI pieces
- **`contexts/`** / **`hooks/`** — auth context, socket connection, react-query setup
- **`lib/`** — typed API clients (`apiAgents`, `apiUsers`, etc.) and the `apiClient` endpoint registry
- **`__tests__/`** — Vitest unit tests

## Design notes

- **Mantine** for components, **react-router-dom** v7 for routing, **TanStack Query** for fetching, **socket.io-client** for live updates ([doc 007](../../../docs/007-web-auth.md) covers auth/sessions)
- All button/action visibility comes from HATEOAS actions returned by the server — see [doc 012](../../../docs/012-hateoas.md). UI uses `hasAction(actions, "name")` rather than inventing permission logic
- Passkey login via `@simplewebauthn/browser`; QR-code registration via `qrcode.react`
- Charts (cost analysis, dashboards) use Chart.js via `react-chartjs-2`
- Shared UI primitives (action buttons, diff viewers, markdown, secret fields, version badge, log viewer) come from [`@naisys/common-browser`](../../../packages/common-browser/README.md)
- Live state (agents, hosts, mail, chat, status) is socket-pushed; no polling

## License

MIT

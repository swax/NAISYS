# NAISYS Project

A monorepo containing NAISYS (Networked Agents Interface System) — an autonomous agent runner with optional web-based management.

[NPM](https://www.npmjs.com/package/naisys) | [Website](https://naisys.org) | [Discord](https://discord.gg/JBUPWSbaEt) | [Demo Video](https://www.youtube.com/watch?v=Ttya3ixjumo)

## Install

```bash
# Core agent runner (no persistence, no web UI)
npm install -g naisys

# Optional add-ons
npm install -g @naisys/hub                  # Persistence via SQLite, multi-instance coordination
npm install -g @naisys/supervisor            # Web UI for monitoring agents, logs, and messaging
npm install -g @naisys/erp                   # Web UI for AI-driven order/work management
```

## Components

- **naisys** — Ephemeral agent runner. LLMs operate a Linux shell with built-in context management and cost tracking. No database required.
- **@naisys/hub** — Adds persistence via SQLite. Tracks agents, logs, costs, mail, and coordinates multiple NAISYS instances over WebSocket.
- **@naisys/supervisor** — Web UI for monitoring agents, viewing logs, and managing inter-agent messaging. Connects to Hub.
- **@naisys/erp** — Web UI for AI-driven order/work management. Runs as a plugin inside Supervisor or standalone.

## Quick Start

### From npm

```bash
npm install -g naisys @naisys/hub @naisys/supervisor @naisys/erp
naisys path/to/agent.yaml --integrated-hub --supervisor --erp
```

### From source

```bash
npm install
npm run build
cd apps/naisys
node dist/naisys.js ../../agents/assistant.yaml --integrated-hub --supervisor --erp
```

### Configure Environment

Create a `.env` file (see `apps/naisys/.env.example`) with your API keys.

Open `http://localhost:3001/supervisor/` to monitor agents.

## Startup Modes

### Ephemeral (no persistence)

```bash
# Run a single agent with no Hub — stateless, no web UI
node dist/naisys.js path/to/agent.yaml
```

### All-in-one (single process)

```bash
# Hub + Supervisor + ERP in one process (saves ~150MB vs separate processes)
node dist/naisys.js agent.yaml --integrated-hub --supervisor --erp

# Hub + Supervisor only (no ERP)
node dist/naisys.js agent.yaml --integrated-hub --supervisor

# Hub only (no web UI)
node dist/naisys.js agent.yaml --integrated-hub
```

### Distributed (separate processes)

Run each component independently for larger deployments:

```bash
# 1. Start Hub standalone (from apps/hub)
node dist/naisysHub.js [agent-path] [--supervisor] [--erp]

# 2. Start Supervisor standalone (from apps/supervisor/server)
#    Set HUB_URL in .env to point to the Hub
node dist/supervisorServer.js

# 3. Start ERP standalone (from apps/erp/server)
#    Has its own auth when running outside Supervisor
node dist/erpServer.js

# 4. Connect NAISYS instances to a remote Hub
node dist/naisys.js agent.yaml --hub=https://hostname:3101
```

## Additional Information

- See [apps/naisys/README.md](apps/naisys/README.md) for detailed NAISYS documentation
- See [apps/supervisor/README.md](apps/supervisor/README.md) for Supervisor documentation

## Requirements

- Node.js 20 or higher
- Linux, Mac, Windows
- lynx browser: `apt install lynx` (Linux) or `brew install lynx` (macOS)

## License

MIT

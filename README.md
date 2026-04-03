# NAISYS 3.0

Autonomous AI agent runner for Linux, Windows, and Mac.

- **LLM support** — OpenAI, Google, Anthropic, and any OpenAI-compatible local LLM
- **Console & desktop control** — Agents operate a shell and can control the GUI/desktop
- **Multi-agent communication** — Agents collaborate via built-in mail and sub-agent systems
- **Networked** — Flex agents across multiple machines, managed through a central hub server
- **Web management** — Monitor agents, logs, costs, and messaging through a browser UI

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

- **naisys** — Agent runner. LLMs operate a Linux shell with built-in context management, multi-agent communication, and cost tracking.
- **@naisys/hub** — Central server that adds persistence and enables agents to communicate across machines. Tracks logs, costs, and mail via SQLite. Optional Supervisor/ERP integration.
- **@naisys/supervisor** — Web UI for monitoring agents, viewing logs, and managing inter-agent messaging.
- **@naisys/erp** — AI-driven order and work management. Runs integrated with Supervisor or standalone.

## Getting Started

Create a `.env` file with your API keys (see `apps/naisys/.env.example`).

### Ephemeral Mode

Lightweight agent runner with no persistence or web UI. Runs agents on demand.

```bash
npm install -g naisys
naisys agent.yaml
```

Pass a directory to run all agent yamls in that folder.

### Integrated Mode

Everything in a single process — Hub for persistence, Supervisor web UI, and optional ERP. The `<seed>` argument is an agent yaml or directory that seeds the Hub database on first run.

```bash
npm install -g naisys @naisys/hub @naisys/supervisor @naisys/erp
naisys <seed> --integrated-hub --supervisor --erp
```

Open `http://localhost:3001/supervisor/` to monitor agents.

### Distributed Mode

Run Hub + Supervisor on a central server, then connect NAISYS runners from multiple machines. Manage all hosts and agents through the Supervisor web UI.

```bash
# On the server
npm install -g @naisys/hub @naisys/supervisor @naisys/erp
naisys-hub [seed] --supervisor --erp

# On each runner machine
npm install -g naisys
naisys --hub=https://hub-server:3101    # Set HUB_ACCESS_KEY in .env
```

### From Source

```bash
npm install && npm run build
cd apps/naisys
node dist/naisys.js ../../agents/assistant.yaml --integrated-hub --supervisor --erp
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

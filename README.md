# NAISYS

[NPM](https://www.npmjs.com/package/naisys) | [Website](https://naisys.org) | [Discord](https://discord.gg/JBUPWSbaEt) | [Demo Video](https://www.youtube.com/watch?v=Ttya3ixjumo)


Self-hosted, cross-machine, AI agent runner and manager that runs on Node.js

- **LLM support** — OpenAI, Google, Anthropic, and any OpenAI-compatible local LLM
- **Console & desktop control** — Agents operate a shell and can control the GUI/desktop
- **Multi-agent** — Organize agents into teams, communicate via mail, wake on messages, and scale across machines through a self-hosted hub
- **Web management** — Monitor agents, logs, costs, and messaging through a browser UI
- **Cost controls** — Costs tightly tracked, requiring a spend limit (fixed or rolling window), no uncapped runs

## Packages

| Name | Description |
|---------|-------------|
| `naisys` | Agent runner — LLMs operate a Linux shell with built-in context management, multi-agent communication, and cost tracking |
| `@naisys/hub` | Central server that adds persistence and enables agents to communicate across machines. Tracks logs, costs, and mail via SQLite |
| `@naisys/supervisor` | Web UI for monitoring agents, viewing logs, and managing inter-agent messaging |
| `@naisys/erp` | Optional AI-driven order and work management. Runs integrated with Supervisor or standalone |

## Getting Started

Create an agent YAML file (e.g. `agent.yaml`):

```yaml
username: steve
title: Assistant
shellModel: claude4sonnet
agentPrompt: You are ${agent.username}, a helpful ${agent.title}.
tokenMax: 50000
spendLimitDollars: 3.00
```

See [agents/template.yaml](agents/template.yaml) for all agent options and supported models.

### Ephemeral Mode

Lightweight agent runner with no persistence or web UI. Runs agents on demand. Pass a directory to run all agent yamls in that folder.

```bash
npx naisys agent.yaml
```

An `.env` file is auto-created on first run (see [.env.example](apps/naisys/.env.example) for options).

### Integrated Mode

Everything in a single process — Hub for persistence, Supervisor web UI, and optional ERP. Requires a local install since multiple packages are needed:

```bash
mkdir naisys && cd naisys
npm install naisys @naisys/hub @naisys/supervisor @naisys/erp
npx naisys --integrated-hub --supervisor --erp
```

Open `http://localhost:3001/supervisor/` to monitor agents.

### Distributed Mode

Run Hub + Supervisor on a central server and extend it with NAISYS instances on other machines that the hub controls. Each instance can run many agents simultaneously with both console and desktop access. Manage it all through the Supervisor web UI. Best practice is to run NAISYS from a dedicated server or VM using a dedicated user account.

```bash
# Setup PM2 (optional) to ensure your NAISYS server/clients stay up
npm install -g pm2
```

```bash
# On the server
mkdir naisys && cd naisys
npm install naisys @naisys/hub @naisys/supervisor @naisys/erp
pm2 start npx -- naisys --integrated-hub --supervisor --erp
# The first run will prompt you to setup the .env file
# You can run the hub alone with: naisys-hub --supervisor --erp
```

```bash
# On each client machine — set HUB_ACCESS_KEY in .env
mkdir naisys && cd naisys
npm install naisys
pm2 start npx -- naisys --hub=https://hub-server:3101
# The first run will prompt you to setup the .env file with hub access key
```

```bash
# Setup PM2 (optional) to launch NAISYS servers/clients on startup
pm2 startup   # enable start on boot (one-time sudo)
pm2 save
```

### From Source

```bash
npm install && npm run build
cd apps/naisys
node dist/naisys.js ../../agents/assistant.yaml --integrated-hub --supervisor --erp
```

### NAISYS ERP

A light free ERP system optimized for agents by utilizing advanced HATEOAS for API self discovery as well as optimized request/response to minimize payloads. NAISYS ERP enables the controlled release of instructions for agents to follow, helping to minimize variation in task results. A completely optional package that can be run in-process or standalone.

## Additional Information

- See [agents/template.yaml](agents/template.yaml) for all agent configuration options and supported models
- See [apps/naisys/README.md](apps/naisys/README.md) for detailed NAISYS documentation
- See [apps/supervisor/README.md](apps/supervisor/README.md) for Supervisor documentation

## Requirements

- Node.js 22 or higher
- Linux, Mac, Windows
- lynx browser: `apt install lynx` (Linux) or `brew install lynx` (macOS)
  - For text web browsing, in desktop mode NAISYS can use graphical web browsers

## License

MIT

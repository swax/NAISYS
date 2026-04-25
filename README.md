# NAISYS

[NPM](https://www.npmjs.com/package/naisys) | [Website](https://naisys.org) | [Discord](https://discord.gg/JBUPWSbaEt)

Self-hosted, cross-machine AI agent runner and manager that runs on Node.js.

- **Collaborative** — invite others with fine-grained permissions to manage agents, teams, and machines together
- **Multi-agent** — organize agents into teams, communicate via mail, wake on messages, scale across machines
- **Computer use** — agents can fully control Windows/Mac/Linux desktop, shell and headless browser
- **Cost controls** — per-agent spend limits (fixed or rolling window), no uncapped runs
- **All vendors supported** — OpenAI, Google, Anthropic, OpenRouter, and local LLMs
- **Remote management** — manage agents, hosts, costs, and messaging through a self-hosted web UI

## Three ways to run NAISYS

|                              | **Local** | **Server** | **Host** |
|------------------------------|-----------|------------|----------|
| One-off runs, no setup       | ✓         |            |          |
| Web UI & saved logs          |           | ✓          | via server |
| Cross-agent mail persisted   |           | ✓          | via server |
| Remote management            |           | ✓          | via server |
| Joins a remote server        |           |            | ✓        |

Pick **Local** to try an agent out. Pick **Server** for your day-to-day setup. Add **Hosts** when you want agents to run across multiple machines — each host can offer different resources (a GPU box, a desktop for computer use, a Windows VM) and agents can run on any host or be pinned to one.

Requires Node.js 22+ on every machine (`node -v`).

### Local

Runs one or more agents on this machine. No hub, no web UI, nothing saved to disk.

```bash
npm install naisys
npx naisys agent.yaml
```

The setup wizard on first run walks you through a [.env](apps/naisys/.env.example) and [agent.yaml](agents/template.yaml). Pass a directory to run every agent yaml inside it.

### Server

Everything in one process — Hub for persistence, Supervisor web UI, and optional ERP. Agent logs are saved, mail survives restarts, and you manage the whole setup from the browser.

```bash
npm install naisys @naisys/hub @naisys/supervisor @naisys/erp
npx naisys --integrated-hub --supervisor --erp
```

Startup prints the supervisor URL and the command to set the superadmin password. For a production install that auto-restarts, see [PM2 deployment](guides/pm2-deployment.md).

### Host

Ties this machine into a running Server. The server can start/stop agents here, route mail to and from here, and stream logs. Best practice is to run NAISYS inside a dedicated VM or user account.

First expose the Server if it isn't already public — [ngrok](https://ngrok.com/) is the easiest path:

```bash
ngrok http <port of your naisys server>
```

Then on each machine you want to join:

```bash
npm install naisys
npx naisys --hub=https://<server>/hub
```

## Packages

NAISYS is split into four packages, each with its own README:

- [`naisys`](apps/naisys/README.md) — the agent runner
- [`@naisys/hub`](apps/hub/README.md) — central server for persistence and cross-machine communication
- [`@naisys/supervisor`](apps/supervisor/README.md) — web UI for monitoring and managing agents
- [`@naisys/erp`](apps/erp/README.md) — AI-optimized order/task management system

## More

### Guides

- [PM2 deployment](guides/pm2-deployment.md) for production servers and hosts
- [XFCE / VNC host setup](guides/xfce-computer-use.md) for desktop computer-use agents
- [Running from source](#running-from-source) below
- [Release and versioning](release/README.md)

### Design docs

- [Architecture overview](docs/000-architecture.md) — how the packages fit together
- [HATEOAS API design](docs/012-hateoas.md) — how the supervisor and ERP expose AI-first REST APIs
- [Computer use](docs/013-computer-use.md) — coord spaces, focus, and per-vendor contracts for desktop control
- [Database design](docs/001-database-design.md) — Prisma strategy, the three schemas, migrations
- [Agent config options and supported models](agents/template.yaml)
- Other design docs under [`docs/`](docs/) cover the larger initiatives (multi-machine, mail, web auth, supervisor users, port strategy, hub security, mail attachments)

### Running from source

```bash
git clone https://github.com/swax/NAISYS.git
npm install && npm run build
mkdir testrun && cd testrun
node ../apps/naisys/dist/naisys.js --integrated-hub --supervisor --erp
```

## Requirements

- Node.js 22 or higher
- Linux, Mac, Windows
- `lynx` browser: `apt install lynx` (Linux) or `brew install lynx` (macOS)
  - For text web browsing; in desktop mode NAISYS can use graphical web browsers

## License

MIT

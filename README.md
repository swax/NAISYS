# NAISYS

[NPM](https://www.npmjs.com/package/naisys) | [Website](https://naisys.org) | [Discord](https://discord.gg/JBUPWSbaEt)

NAISYS is a self-hosted system for a group of people to pool machines, model accounts, and work into one shared organization of humans and AI agents.

Run a local server, open the browser UI, create agents, invite people, and let everyone add the machines they can contribute. A laptop can handle chat or code agents, a GPU box can serve local models, a Windows desktop can run computer-use tasks, and a VM can take always-on background work. Agents can run anywhere in the cluster or be pinned to specific hosts.

## Start here

Requires Node.js 22+ on every machine (`node -v`).

```bash
npm install naisys @naisys/hub @naisys/supervisor @naisys/erp
npx naisys --integrated-hub --supervisor --erp
```

The first-run wizard creates the local config, then NAISYS prints the local Supervisor URL. Open that URL and use the GUI from there: create agents, add more hosts, invite users, assign permissions, inspect consoles, review runs, send mail, and track cost.

For a production install that auto-restarts, see [PM2 deployment](guides/pm2-deployment.md).

## Build a shared cluster

1. Start the integrated server on one machine.
2. Make it reachable by the group with a reverse proxy or a tunnel like [ngrok](https://ngrok.com/).
3. Create user accounts for the people who should help manage the organization.
4. Have each person add their machine as a host:

```bash
npm install naisys
npx naisys --hub=https://<server>/hub
```

The hub keeps logs, mail, cost history, variables, and agent state. Hosts stay replaceable: if a machine disconnects, the organization still has its history and can run work somewhere else.

## What you can do

- **Manage people and agents together** - users, permissions, API keys, human-managed agents, and LLM-backed agents in one system
- **Pool different machines** - desktops, laptops, VMs, GPU boxes, Windows/Mac/Linux hosts, and restricted hosts for explicitly assigned agents
- **Assign work by host** - run agents anywhere in the cluster or pin them to machines with the right tools, OS, GPU, browser, or desktop session
- **Watch the work happen** - live consoles, run logs, screenshots, mail, chat, host status, and command-level history from the browser
- **Control spend** - per-agent spend limits, rolling windows, model pricing, cost charts, and suspended status when an agent hits its cap
- **Use any model stack** - OpenAI, Anthropic, Google, OpenRouter, Grok, and local LLMs
- **Give agents real tools** - shell, headless browser, desktop computer use, image generation, audio, inter-agent mail, and agent-facing REST APIs
- **Coordinate operational work** - optional ERP for orders, operations, steps, assignments, labor tickets, inventory, and agent-readable workflows

## Packages

NAISYS is split into four packages, each with its own README:

- [`naisys`](apps/naisys/README.md) — the agent runner
- [`@naisys/hub`](apps/hub/README.md) — central server for persistence and cross-machine communication
- [`@naisys/supervisor`](apps/supervisor/README.md) — web UI for monitoring and managing agents
- [`@naisys/erp`](apps/erp/README.md) — AI-optimized order/task management system

## Data, logs, and backups

The setup wizard writes `.env`; `NAISYS_FOLDER` in that file controls where persistent state lives. Databases are stored under `NAISYS_FOLDER/database/`, logs under
`NAISYS_FOLDER/logs/`, and the hub access key under `NAISYS_FOLDER/cert/`.

For production, back up the full `NAISYS_FOLDER`. At minimum, preserve `database/` and `cert/` together so restored hosts can keep their data and hub authentication
intact.

## Details

- [PM2 deployment](guides/pm2-deployment.md) for production servers and hosts
- [XFCE / VNC host setup](guides/xfce-computer-use.md) for desktop computer-use agents
- [Release and versioning](release/README.md)
- [Architecture overview](docs/000-architecture.md) — how the packages fit together
- [HATEOAS API design](docs/012-hateoas.md) — how the supervisor and ERP expose AI-first REST APIs
- [Computer use](docs/013-computer-use.md) — coord spaces, focus, and per-vendor contracts for desktop control
- [Database design](docs/001-database-design.md) — Prisma strategy, the three schemas, migrations
- [Agent config options and supported models](agents/template.yaml)

Other design docs under [`docs/`](docs/) cover multi-machine operation, mail, web auth, supervisor users, port strategy, hub security, and attachments.

## Running from source

```bash
git clone https://github.com/swax/NAISYS.git
cd NAISYS
npm install && npm run build
node apps/naisys/dist/naisys.js --integrated-hub --supervisor --erp
```

## Requirements

- Node.js 22 or higher
- A supported shell — NAISYS proxies one to the LLM:
  - Linux (bash/sh)
  - Windows (PowerShell/WSL)
  - macOS (bash/zsh)
- Optional, per feature:
  - **`ns-lynx`** (text browser): `lynx` — `apt install lynx` or equivalent
  - **`ns-browser`** (headless Chromium): `npm install playwright-core && npx playwright install chromium`
  - **`ns-pty`** (TTY commands like sudo/ssh/passwd): Linux only
  - **`ns-desktop`** (GUI computer use) — supported per platform:
    - **Windows**: Works out of the box
    - **macOS** (preliminary): `cliclick` + `screencapture`
    - **Linux X11**: `xdotool` + `scrot` (or `gnome-screenshot` / `import`)
    - **Linux Wayland**: `ydotool` + `grim`
    - See the [XFCE / VNC host setup guide](guides/xfce-computer-use.md) for a recommended headless Linux setup

## Troubleshooting

- Check `node -v`; every machine needs Node.js 22 or newer.
- If a server port is busy, set `SERVER_PORT` in `.env` and restart.
- If a host cannot connect to a remote hub, verify the `--hub` URL includes `/hub` and that the local hub access key matches the server.
- If `ns-browser` or `ns-desktop` fails, install the optional browser/desktop dependencies listed above.
- Check `NAISYS_FOLDER/logs/` for hub, supervisor, ERP, and runner logs.

## License

MIT

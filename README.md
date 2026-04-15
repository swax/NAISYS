# NAISYS

[NPM](https://www.npmjs.com/package/naisys) | [Website](https://naisys.org) | [Discord](https://discord.gg/JBUPWSbaEt) | [Demo Video](https://www.youtube.com/watch?v=Ttya3ixjumo)

Self-hosted, cross-machine, AI agent runner and manager that runs on Node.js

- **LLM support** — OpenAI, Google, Anthropic, and any OpenAI-compatible local LLM
- **Console & desktop control** — Agents operate a shell and can control the GUI/desktop
- **Multi-agent** — Organize agents into teams, communicate via mail, wake on messages, and scale across machines through a self-hosted hub
- **Web management** — Monitor agents, logs, costs, and messaging through a browser UI
- **Cost controls** — Costs tightly tracked, requiring a spend limit (fixed or rolling window), no uncapped runs

## Packages

| Name                 | Description                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `naisys`             | Agent runner — LLMs operate a Linux shell with built-in context management, multi-agent communication, and cost tracking        |
| `@naisys/hub`        | Central server that adds persistence and enables agents to communicate across machines. Tracks logs, costs, and mail via SQLite |
| `@naisys/supervisor` | Web UI for monitoring agents, viewing logs, and managing inter-agent messaging                                                  |
| `@naisys/erp`        | Optional AI-driven order and work management. Runs integrated with Supervisor or standalone                                     |

## Getting Started

### Ephemeral Mode

Lightweight agent runner with no persistence or web UI. Runs agents on demand. Pass a directory to run all agent yamls in that folder. Make sure you're running at least Node.js 22 `node -v`

```bash
npm install naisys
npx naisys agent.yaml
```

The setup wizard on first run will guide you through creating a [.env](apps/naisys/.env.example) and [agent.yaml](agents/template.yaml) file.

### Integrated Mode

Everything in a single process — Hub for persistence, Supervisor web UI, and optional ERP. Requires a local install since multiple packages are needed:

```bash
npm install naisys @naisys/hub @naisys/supervisor @naisys/erp
npx naisys --integrated-hub --supervisor --erp
```

When the process starts up it gives you a link to the supervisor UI and a command to change the superadmin password. 

### Simple Client/Server with ngrok

Host a NAISYS server on your own machine and connect remote machines to it through ngrok. This gives you remote management for free with no central server required. Best practice is to run NAISYS clients and servers from within a VM on their own NAISYS account.

Start with the integrated server command above, and then expose the server with [ngrok](https://ngrok.com/):

```bash
ngrok http <port of your naisys instance>
```

Then on each client machine run this command. This will allow NAISYS to start/stop agents on the machine.

```bash
npm install naisys
npx naisys --hub=https://<server>/hub
```

That's it — you now have a self-hosted cluster of machines to run agents across. The agents can securely communicate with each other, all managed through the supervisor AI.

### Advanced Client/Server with PM2

PM2 keeps NAISYS running through system restarts, NAISYS upgrades, and unexpected crashes. NAISYS server uses around 180MB, so if you want you could easily host it on a $6/month Digital Ocean Droplet VM.

Create a dedicated user on server/clients for NAISYS

```bash 
npm install -g pm2
sudo useradd -m -s /bin/bash naisys
sudo su - naisys
```

Install NAISYS on the server like above then run:

```bash
pm2 start npx --name naisys-server -- naisys --integrated-hub --supervisor --erp
```

Similarly on each client install NAISYS then run

```bash
pm2 start npx --name naisys-client -- naisys --hub=https://<server>/hub
```

Finish PM2 setup to ensure it starts NAISYS on boot

```bash
pm2 startup
pm2 save
```

### Installing/Running from Source

```bash
git clone https://github.com/swax/NAISYS.git
npm install && npm run build
mkdir testrun && cd testrun
node ../apps/naisys/dist/naisys.js --integrated-hub --supervisor --erp
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

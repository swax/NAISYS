# NAISYS Project

A monorepo containing NAISYS (Networked Agents Interface System) and Supervisor (web-based agent management interface).

[NPM](https://www.npmjs.com/package/naisys) | [Website](https://naisys.org) | [Discord](https://discord.gg/JBUPWSbaEt) | [Demo Video](https://www.youtube.com/watch?v=Ttya3ixjumo)

```bash
npm install -g naisys
```

## What's Included

- **NAISYS** - Allows LLMs to operate a standard Linux shell autonomously with built-in context management, multi-agent communication, and cost tracking
- **Supervisor** - Web interface for monitoring NAISYS agents, viewing logs, and managing inter-agent messaging

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Configure Environment

Create `apps/naisys/.env` file using the `.env.example` file as a guide.

### 4. Run an Agent

```bash
cd apps/naisys
node dist/naisys.js ../../agents/assistant.yaml --supervisor
```

### 5. Open Supervisor Interface

Navigate to `http://localhost:3001` in your browser to monitor your NAISYS agents.

## Additional Information

- See [apps/naisys/README.md](apps/naisys/README.md) for detailed NAISYS documentation
- See [apps/supervisor/README.md](apps/supervisor/README.md) for Supervisor documentation

## Requirements

- Node.js 18.0.0 or higher
- Linux or WSL (for Windows users)
- lynx browser: `apt install lynx` (Linux) or `brew install lynx` (macOS)

## License

MIT

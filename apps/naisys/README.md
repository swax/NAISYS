# NAISYS (Networked Agents Interface System)

[← Back to main README](../../README.md)

NAISYS is the agent runner: it proxies a real shell to any LLM (Anthropic, OpenAI, Google, Grok, OpenRouter, local), keeps the context within configured token/cost limits, and exposes a set of `ns-*` commands that make the shell "context friendly" — paginated web browsing, inter-agent mail, sub-agent spawning, image generation, desktop control, and more.

For the full GUI stack (hub + supervisor + ERP) see the [main README](../../README.md). This page covers the runner itself.

## Running agents locally

No hub, no web UI, nothing persisted unless the agent writes files itself.

```bash
npm install naisys
npx naisys agent.yaml
```

## Running as a cluster host

Connect this machine to a remote hub so the organization can start, stop, assign, and monitor agents here. Agents, mail, logs, and cost tracking flow through the hub:

```bash
npx naisys --hub=https://<server>/hub
```

Best practice is to run inside a dedicated VM or user account on shared hosts.

Create a `.env` from [.env.example](.env.example) (or let the setup wizard walk you through it). Pass a yaml file or a directory of yaml files; a directory runs every agent inside it. Start from [`agents/template.yaml`](../../agents/template.yaml):

```yaml
username: smith
title: Software Engineer
shellModel: claude4sonnet
agentPrompt: |
  You are ${agent.username} a ${agent.title} with the job of building a website.
tokenMax: 50000
debugPauseSeconds: 5
spendLimitDollars: 5.00
```

## Using the debug prompt

- NAISYS starts at a debug prompt where you can run commands interactively
- Hit `Enter` on an empty prompt to let the LLM take a turn; NAISYS returns to the debug prompt after each response
- `debugPauseSeconds` controls behavior between turns: `0` = continue immediately, positive = pause that long, unset = pause indefinitely. `wakeOnMessage` wakes early on new mail.

Console color legend: **purple** = LLM response (in context), **white** = shell output (in context), **green** = debug prompt (not in context), **red** = NAISYS errors (not in context).

## Features

### Agent commands

All built-in commands use an `ns-*` prefix for discoverability ([doc 003](../../docs/003-revise-commands.md)).

- `ns-help`, `ns-users` — registry-driven help and relevant-user directory
- `ns-agent` — start/stop/peek/local subagents; `peek` works across the cluster
- `ns-mail` — flat (non-thread) mail model ([doc 002](../../docs/002-revised-llmail-plan.md)), `@host` addressing, short-id threads, archive-all, from-title, gap detection/recovery, markdown, cross-machine delivery through the hub
- `ns-chat` — shorter-form conversation service layered on mail
- `ns-lynx` — text web browser, cost-tracked Google Custom Search
- `ns-browser` — headless Chromium via Playwright; selector-based click/fill, on-demand screenshots
- `ns-genimg` — image generation (vendor-agnostic model registry)
- `ns-look` — load images into LLM context
- `ns-listen` — audio listening with optional transcription
- `ns-desktop` — screenshot / click / key / focus / hold, usable from the console without tool calls, runs on any model with image input (not just models with native computer use); see the [XFCE/VNC host setup guide](../../guides/xfce-computer-use.md) and [doc 013](../../docs/013-computer-use.md) for the coord-space / focus / vendor design
- `ns-session` — consolidated pause/compact/wait
- `ns-workspace` — cache-friendly per-agent file list
- `ns-pty` — run a command in a pseudo-terminal so it sees stdin/stdout as a TTY (sudo, ssh, passwd); Linux only
- `ns-comment` — agent comment/thinking capture
- Custom `ns-*` commands with env-var expansion defined per agent

### Debug commands

Available only at the local debug prompt; not exposed to the LLM.

- `ns-cmd <command>` (shortcut `!<command>`) — run a command as if the LLM had typed it so input and output land in the LLM context
- `ns-talk` (shortcut `@<message>`) — send a message to the agent
- `ns-context` — print the current LLM context
- `ns-pause [on|off]` — toggle the loop's pause state locally (reproduces the remote pause)
- `ns-cost` — show token usage and cost tracking
- `ns-config` — view or update agent config (update only lasts for the current session)
- `ns-host` — list all known hosts and their status
- `ns-hub` — show hub connection status
- `exit` / `exit all` — exit the current agent, or shut down all agents and end the application

### Models

- Anthropic Claude (with extended thinking and tool-use completion), OpenAI (Responses API), Google Gemini, Grok, OpenRouter, and local LLMs
- Computer-use integrations for Claude, Gemini, and OpenAI
- Desktop control on Linux (X11/Wayland), Windows (PowerShell, no WSL), and macOS (`cliclick`, preliminary)
- DB-backed, user-editable LLM and image model catalogs
- `none` LLM type for human-managed agents; `mock`/`dummy` for testing

### Session, cost, and safety

- Per-agent and global spend limits with rolling windows; cost-suspended status surfaced to the supervisor
- Mid-loop token/context checks; pre-emptive compaction before cache expiry (`cacheTtl`); rollback on invalid media
- "Semi-auto" command protection — only confirms flagged commands, considers the agent's rationale
- `Esc` cancels the current LLM query

### Runner

- In-process multi-agent manager with output buffering for inactive consoles
- `--setup` wizard generates `.env` interactively
- Auto-update service with rollback and minimum-version floor
- Per-agent home directory via `naisys_folder`
- DB-backed variables with sensitive-value hiding and optional shell export

## Requirements

NAISYS proxies a real shell to the LLM, so a supported shell is required:

- **Linux** (bash/sh)
- **Windows** (PowerShell/WSL)
- **macOS** (bash/zsh)

Optional, per feature — install only what your agents use:

- **`ns-lynx`** (text browser): `lynx` — `apt install lynx` or equivalent
- **`ns-browser`** (headless Chromium): `npm install playwright-core && npx playwright install chromium`
- **`ns-pty`** (TTY-aware commands like sudo, ssh, passwd): Linux only
- **`ns-desktop`** (GUI computer use):
  - **Windows**: Works out of box
  - **macOS** (preliminary): `cliclick` + `screencapture`
  - **Linux X11**: `xdotool` + `scrot` (or `gnome-screenshot` / `import`)
  - **Linux Wayland**: `ydotool` + `grim`
  - See the [XFCE / VNC host setup guide](../../guides/xfce-computer-use.md) for a recommended Linux setup, and [doc 013](../../docs/013-computer-use.md) for the per-vendor design

## License

MIT

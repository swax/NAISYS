# NAISYS (Networked Agents Interface System)

[← Back to main README](../../README.md)

NAISYS is the agent runner: it proxies a real shell to any LLM (Anthropic, OpenAI, Google, Grok, OpenRouter, local), keeps the context within configured token/cost limits, and exposes a set of `ns-*` commands that make the shell "context friendly" — paginated web browsing, inter-agent mail, sub-agent spawning, image generation, desktop control, and more.

Run agents locally with `npx naisys agent.yaml`, or connect to a hub for persistence and cross-machine operation.

## Getting Started

- Create a `.env` file based on `.env.example` (or let `--setup` walk you through it)
- Create an agent configuration file — see [`agents/template.yaml`](../../agents/template.yaml) for all available options and supported models
- Run `naisys <path to agent yaml or directory> [options]`
  - Pass a directory to run all agent yamls in that folder

A minimal agent:

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

## Using NAISYS

### The Basics

- NAISYS starts at a debug prompt — where you can run commands interactively
- Hit `Enter` on an empty prompt to let the LLM take a turn
- After the LLM responds, NAISYS returns to the debug prompt
- `debugPauseSeconds` controls behavior: `0` = continue immediately, positive = pause that long, unset = pause indefinitely; `wakeOnMessage` wakes early on new mail

### Console Color Legend

- Purple: LLM response, added to context
- White: Local/shell output, added to context
- Green: Debug prompt and responses, not added to context
- Red: High-level NAISYS errors, not added to context

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

### LLM and model support

- Anthropic Claude 4.5 and Haiku 4.5
- Extended thinking for Anthropic models
- Tool-use-based prompt completion for Anthropic and OpenAI
- OpenAI Responses API, updated GPT catalog and pricing
- Grok 4
- Google Gemini with tool/cache cost tracking
- Gemini, OpenAI, and Claude computer-use integrations
- Windows desktop computer-use (Claude + PowerShell control, no WSL required)
- Preliminary macOS desktop support via `cliclick`
- Ubuntu/Wayland desktop control
- DB-backed, user-editable LLM and image model catalogs
- `none` LLM type for human-managed agents
- `mock`/`dummy` LLMs for concurrency and integration testing

### Session, cost, and safety

- Per-agent and global spend limits; time-bounded rolling windows; cost-suspended status surfaced to supervisor
- Cost history aggregated in 5-minute blocks for charting
- Context/token limit checking mid-command loop to avoid blowing past limits
- Pre-emptive session compact before cache expiry; `cacheTtl` config
- Session compactor uses caching and includes media
- Context rollback if invalid media is added
- Random command end-markers to prevent log spoofing
- "Semi-auto" command protection — only confirms flagged commands and considers the agent's own rationale
- Esc to cancel the current LLM query
- Prompt includes timestamp, platform, and resolution on startup

### Runner infrastructure

- In-process multi-agent support via an agent manager, with output buffering when a console is inactive
- `--supervisor` integrated mode runs runner + supervisor in a single process
- `--setup` wizard generates `.env` interactively including supervisor password
- Auto-update service with target version/commit, rollback via `git restore` / `npm ci`, minimum-version floor, stashes local changes, disable flag
- Per-agent home directory when `naisys_folder` is set
- Batched logs pushed to hub for all agents
- PowerShell multi-line command handling (dot-source + try/finally + policy bypass)
- Variables stored in DB; sensitive flag hides them in the UI; optional export to shell

### Remote / cross-machine

- Hub connection required for clustered mode; indefinite reconnect on disconnect; new connection from the same host supersedes a stale one
- Remote start/stop/log/peek of agents via hub
- Remote debug command input from the supervisor to the agent
- Remote `pause` routed supervisor → hub → runner
- Restricted hosts that only run explicitly assigned agents
- Cross-machine mail with `@host` addressing
- Mail/chat file attachments delivered through the hub ([doc 011](../../docs/011-mail-attachments.md))
- Auto-start agent on new mail/chat in local mode ([doc 004](../../docs/004-start-agents-on-mail.md))
- Hostname changes pushed from supervisor and stored with history
- Command-loop / run-session state sent to supervisor so the user sees definitive active status

## Changelog

- 3.0: ERP and desktop control
- 2.2: Cross-machine support via the hub process
- 2.1: Monorepo architecture; supervisor can run in-process
- 2.0: Agent multiplexing in the same process
- 1.7: Prompt caching, ns-lynx pagination, complete-task command
- 1.6: Long-running shell commands and full-screen terminal output
- 1.5: Agents can start their own parallel sub-agents
- 1.4: `ns-genimg` image generation
- 1.3: Post-session compaction and mail 'blackout' period
- 1.2: Stand-in shell commands for custom NAISYS commands
- 1.1: Command protection to prevent unwanted writes
- 1.0: Initial release

## License

MIT

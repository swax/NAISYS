# Revise Commands

## Overview

Renamed all NAISYS-specific commands to use the `ns-` prefix and refactored the command handler to use a registry pattern. Each command is described by a shared `CommandDef`, and services expose a `RegistrableCommand` (a `CommandDef` plus a handler) that the dispatcher looks up by name.

## Command Renaming

All NAISYS commands now use the `ns-` prefix:

| Old Command                                  | New Command               |
| -------------------------------------------- | ------------------------- |
| subagent                                     | ns-agent                  |
| comment                                      | ns-comment                |
| genimg                                       | ns-genimg                 |
| llmynx                                       | ns-lynx                   |
| llmail                                       | ns-mail                   |
| cost                                         | ns-cost                   |
| talk                                         | ns-talk                   |
| context                                      | ns-context                |
| pause, completetask, endsession, trimsession | ns-session (consolidated) |

Additional commands introduced or normalized under the `ns-` prefix:

- `ns-look`, `ns-listen` — media inspection
- `ns-desktop` — desktop interaction (screenshot, focus, key, hold, click, type, dump)
- `ns-chat` — lightweight team chat (separate from `ns-mail`)
- `ns-users` — relevant-user directory
- `ns-workspace` — pinned-file workspace
- `ns-config`, `ns-host`, `ns-hub`, `ns-pause` — debug/operator commands
- `ns-help` — built-in, auto-populated from the registry

### Reasons

1. **Clarity** — Clear which commands are NAISYS-specific vs system commands.
2. **Avoid conflicts** — Generic names like `host` conflict with Linux commands; `ns-host` is unambiguous.
3. **Understandable** — `ns-mail` is more intuitive than `llmail`.

### Session Command Consolidation

The `ns-session` command consolidates what used to be separate bin scripts. The final subcommands are:

- `ns-session wait <seconds>` — Pause and wait (auto-wakes on new mail or other events). Replaces the old `pause` script; named `wait` because the loop can wake early.
- `ns-session compact` — Compact the session and reset the token count. Replaces `endsession`.
- `ns-session complete "<result>"` — Complete the session; result is mailed to the lead agent or admin. Replaces `completetask`.

The previously planned `ns-session trim <indexes>` was **not** implemented — trimming arbitrary prompts by index wasn't worth the complexity versus `compact`.

Additional internal subcommands (`help`, `continue-wait`, `preemptive-compact`, `restore`) exist for loop plumbing but are not part of the public surface.

## Command Handler Refactor

The switch statement in `commandHandler.ts` was replaced with a registry:

- Each service exports a `RegistrableCommand` (`{ command: CommandDef; handleCommand(args) }`).
- `createCommandRegistry()` in `commandRegistry.ts` builds an O(1) lookup map from command names and aliases to their handlers, and auto-registers a built-in `ns-help` that introspects the registry.
- `commandHandler.processCommand` first checks the registry; anything unmatched falls through to `shellCommand.handleCommand`.
- Each service owns its own command handling logic.

### Registry Wiring

Registry is assembled in `agentRuntime.ts`. Registered commands include:

- `ns-comment` — inline thought marker (small shim declared in `agentRuntime.ts`)
- `ns-lynx` — context-friendly browser (`lynxService`)
- `ns-genimg` — image generation (`genimg`)
- `ns-desktop` — desktop/computer-use (`desktopService`)
- `ns-look`, `ns-listen` — media into context (`lookService`, `listenService`)
- `ns-agent` — sub-agent management (`subagentService`)
- `ns-mail` — inter-agent mail (`mailService`)
- `ns-chat` — team chat (`chatService`)
- `ns-cost` — token/cost reporting (`costDisplayService`)
- `ns-session` — session control (`sessionService`)
- `ns-workspace` — pinned-file workspace (`workspaces`)
- `ns-users` — relevant-user directory (`userDisplayService`)
- `ns-config` — view/update agent config (`agentConfig`)
- `ns-context`, `ns-talk`, `ns-pause`, `exit` — debug commands (`createDebugCommands`)
- `ns-hub`, `ns-host` — hub/host status, registered when a hub client is present

### Commands Outside the Registry

Only the shell fallback remains outside the registry: anything not in the map goes through `shellCommand.handleCommand` (with `commandProtection` write-protection checks applied first for LLM input). The originally planned exceptions (`ns-comment`, `ns-talk`, `ns-context`) all ended up in the registry, so there is no NAISYS-specific switch statement anymore.

# Revise Commands

## Overview

Rename all NAISYS-specific commands to use the `ns-` prefix and refactor the command handler to use a registry pattern.

## Command Renaming

Prefix all commands with `ns-`:

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

### Reasons

1. **Clarity** - Clear which commands are NAISYS-specific vs system commands
2. **Avoid conflicts** - Generic names like `host` conflict with Linux commands; `ns-hosts` is unambiguous
3. **Understandable** - `ns-mail` is more intuitive than `llmail`

### Session Command Consolidation

The `ns-session` command consolidates separate bin scripts into a single command with subcommands:

- `ns-session pause <seconds>` - Pause execution for a set number of seconds (replaces `pause`)
- `ns-session trim <indexes>` - Remove prompts by index to save tokens (replaces `trimsession`)
- `ns-session compact "<note>"` - End session and start fresh with a note (replaces `endsession`)
- `ns-session complete "<result>"` - Mark task as complete and exit (replaces `completetask`)

## Command Handler Refactor

Use a registry pattern instead of the current switch statement:

- Each service exports a `RegistrableCommand` with its command name and handler function
- Command handlers are registered via `createCommandRegistry()`
- Dispatcher looks up the command and delegates to the appropriate handler
- Each service owns its own command handling logic

### Commands in Registry

The following commands are registered via the command registry in `agentRuntime.ts`:

- `ns-lynx` - Context-friendly browser
- `ns-genimg` - Image generation
- `ns-agent` - Sub-agent management
- `ns-mail` - Inter-agent communication
- `ns-cost` - Cost tracking
- `ns-session` - Session management

### Commands in Switch Statement

The following commands remain in the command handler switch statement:

- `ns-comment` - LLM thinking out loud
- `ns-talk` - Debug communication with agent
- `ns-context` - Print current context (debug only)

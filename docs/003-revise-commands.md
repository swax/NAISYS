# Revise Commands

## Overview

Rename all NAISYS-specific commands to use the `ns-` prefix and refactor the command handler to use a registry pattern.

## Command Renaming

Prefix all commands with `ns-`:

| Old Command | New Command |
|-------------|-------------|
| llmail | ns-mail |
| llmynx | ns-lynx |
| genimg | ns-img |
| cost | ns-cost |
| (new) | ns-hosts |

### Reasons

1. **Clarity** - Clear which commands are NAISYS-specific vs system commands
2. **Avoid conflicts** - Generic names like `host` conflict with Linux commands; `ns-hosts` is unambiguous
3. **Understandable** - `ns-mail` is more intuitive than `llmail`

## Command Handler Refactor

Use a registry pattern instead of the current switch statement:

- Each service exports a `CommandHandler` with its command name and handler function
- Command handlers are registered in an array/map
- Dispatcher looks up the command and delegates to the appropriate handler
- Each service owns its own command handling logic

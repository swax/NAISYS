# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Compilation

- `npm run build` - Compile TypeScript source to JavaScript in `dist/`
- `npm run clean` - Remove compiled output directory
- `tsc` - Direct TypeScript compilation

### Code Quality

- `npm run eslint` - Run ESLint on source files
- `npm run prettier` - Format all files with Prettier
- `npm run detect-cycles` - Check for circular dependencies
- `npm run dependency-graph` - Generate dependency visualization

### Testing

- `npm test` - Compile and run all Jest tests
- Tests are located in `src/__tests__/` and test the compiled JavaScript in `dist/__tests__/`
- Uses experimental VM modules for ES module testing

### Running Agents

- `npm run agent:assistant` - Run the assistant agent configuration
- `npm run agent:nightwatch` - Run the nightwatch agent configuration
- `node dist/naisys.js <agent.yaml>` - Run any agent configuration file
- `./naisys-tmux.sh start` - Start agent in tmux session for testing (see tmux section below)

### Package Management

- `npm run updates:check` - Check for dependency updates
- `npm run updates:apply` - Apply dependency updates
- `npm run npm:publish:dryrun` - Test package publishing process

## Architecture Overview

NAISYS is an autonomous LLM system that wraps Linux shell environments with enhanced context management, multi-agent communication, and safety features.

### Core Components

**Command System** (`src/command/`):

- `commandLoop.ts` - Main event loop managing LLM/Debug mode switching
- `commandHandler.ts` - Routes commands between built-in NAISYS commands and shell
- `shellWrapper.ts` - Shell abstraction using xterm with timeout handling
- `promptBuilder.ts` - Generates context-aware prompts with token tracking

**LLM Integration** (`src/llm/`):

- `llmService.ts` - Multi-provider LLM client (OpenAI, Anthropic, Google, local)
- `contextManager.ts` - Context management with token counting and trimming
- `costTracker.ts` - API cost tracking with spending limits
- `dreamMaker.ts` - Inter-session memory management

**Features** (`src/features/`):

- `llmail.ts` - Inter-agent communication system
- `llmynx.ts` - LLM-optimized web browser with content summarization
- `subagent.ts` - Dynamic agent spawning and management
- `genimg.ts` - Image generation integration

### Key Architectural Patterns

**Dual Mode Operation**:

- **LLM Mode**: Autonomous AI operation
- **Debug Mode**: Human intervention for debugging/collaboration
- Automatic switching based on errors, timeouts, or manual triggers

**Context Management**:

- Token-aware sessions with configurable limits
- Session trimming capabilities to manage context size
- Previous session continuity via "dream maker" system

**Multi-Agent Architecture**:

- Agent configurations in YAML files under `agents/`
- Built-in mail system for inter-agent communication
- Support for dynamic subagent spawning

### Shell Integration Details

**Command Execution**:

- Persistent bash/WSL shell environments
- Custom timeout handling for long-running commands
- Output token limiting to prevent context pollution
- xterm-based terminal emulation with dimension fallbacks (80x24 default)

**Security**:

- Command protection system with configurable levels (none/manual/auto)
- Spending limits and cost tracking
- Safe command validation

## Configuration

**Agent Configuration** (`agents/*.yaml`):

- `username` - Agent identity and home directory
- `shellModel` - Primary LLM model for console interactions
- `agentPrompt` - System prompt defining agent role
- `tokenMax` - Session context limit
- `spendLimitDollars` - Cost control limit
- Environment variable substitution supported

**Environment Setup** (`.env`):

- `NAISYS_FOLDER` - Agent data and databases location
- `WEBSITE_FOLDER` - Web files and logs location
- LLM API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)

## Development Testing with tmux

The repository includes `naisys-tmux.sh` for programmatic agent testing:

```bash
./naisys-tmux.sh start                    # Start agent in tmux
./naisys-tmux.sh talk "create hello.txt"  # Send talk command
./naisys-tmux.sh output                   # Get current output
./naisys-tmux.sh stop                     # Stop session
```

This enables automated testing and CI/CD integration by running agents in background tmux sessions.

## File Structure Notes

- `src/` - TypeScript source code
- `dist/` - Compiled JavaScript (generated, not committed)
- `agents/` - Agent configuration examples
- `bin/` - Cross-platform binary wrappers
- `eslint-rules/` - Custom ESLint rules for filename consistency

## Important Development Considerations

- All LLM interactions go through `llmService.ts` for consistent cost tracking
- Context management is critical - always consider token limits
- Shell commands execute in persistent sessions - state carries between commands
- Error handling should gracefully switch to debug mode for human intervention
- Multi-agent scenarios require careful cost attribution and communication protocols

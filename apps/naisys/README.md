## NAISYS (Networked Agents Interface System)

[← Back to main README](../../README.md)

NAISYS allows any LLM you want to operate a standard Linux shell given your instructions. You can control how much
to spend, the maximum number of tokens to use per session, how long to wait between commands, etc.. Between each command
NAISYS will wait a few seconds to accept any input you want to put in yourself in case you want to collaborate with the
LLM, give it hints, and/or diagnose the session. Once the LLM reaches the token max you specified for the session it
will wrap things up, and start a fresh shell for the LLM to continue on its work.

NAISYS tries to be a minimal wrapper, just helping the LLM operate in the shell 'better'. Making commands 'context friendly'. For instace if a command is long running, NAISYS will interrupt it, show the LLM the current output, and ask the LLM what it wants to
do next - wait, kill, or send input. The custom command prompt helps the LLM keep track of its token usage during the session. The 'ns-comment' command helps the LLM think out loud without putting invalid commands into the shell.

Some use cases are building websites, diagnosing a system for security concerns, mapping out the topology of the local
network, learning and performing arbitrary tasks, or just plain exploring the limits of autonomy. NAISYS has a built-in
system for inter-agent communication. You can manually startup multiple instances of NAISYS with different roles, or
you can allow agents to start their own sub-agents on demand with instructions defined by the LLM itself!

#### Node.js is used to create a simple proxy shell environment for the LLM that

- Helps the LLM keep track of its current context size
- Gives the LLM the ability to 'reset' the context and carry over information to a new session/context
- Proxy commands to a real shell, and help guide the LLM to use context friendly commands
- Prevent the context from being polluted by catching common errors like output that includes the command prompt itself
- Allows debugging by way of a 'debug' prompt after each run of the LLM
- A custom 'mail' system for context friendly inter-agent communication
- A browser called 'ns-lynx' that uses a separate LLM to reduce web page size as well as make links unique across the context
- Cost tracking and cost limits that must be set in the config
- Support for multiple LLM backends, configurable per agent - OpenAI, Google, Anthropic, and self-hosted LLMs

## Getting Started

- Create a `.env` file based off the `.env.example` file

- Create an agent configuration file `smith.yaml`:

```yaml
# Used to identify the agent on the prompt, logs, home dir, mail, etc..
username: smith

# How other agents will understand the role of this agent
title: Software Engineer

# The model to use for console interactions
# (gpt4turbo, gpt4turbo, gemini-pro, claude3sonnet, claude3opus, local)
shellModel: gpt4turbo

# Only used between sessions to provide guidance for the next session (use a more powerful model for this)
# defaults to the shellModel if omitted
compactModel: claude3opus

# The model to use for ns-lynx, pre-processing websites to fit into a smaller context (use a cheaper model)
# defaults to the shellModel if omitted
webModel: claude3haiku

# The model used by the 'ns-genimg' command. If not defined then the ns-genimg command is not available to the LLM
# Valid values: dalle2-256, dalle2-512, dalle2-1024, dalle3-1024, dalle3-1024-HD
imageModel: dalle3-1024

# A system like prompt explaining the agent's role and responsibilities
# You can use config variables in this string
agentPrompt: |
  You are ${agent.username} a ${agent.title} with the job of creating a Neon Genesis Evangelion fan website.
  The website should be very simple html, able to be used from a text based browser like lynx. Pages should be relatively short.
  The location of the website files should be in ${env.WEBSITE_FOLDER} 
  The website can be tested with 'ns-lynx open ${env.WEBSITE_URL}' to see how it looks in a text based browser.
  You can use PHP as a way to share layout across pages and reduce duplication.
  Careful when creating new files that what you are creating is not already there.

# The number of tokens you want to limit a session to, independent of the LLM token max itself
# A lower max relies more on the LLM ending the session with good enough notes to not get lost when the session restarts
# A higher max allows the LLM to do more without losing track, but is more expensive
tokenMax: 5000

# The number of seconds to pause after each console interaction for debugging and rate limiting
# No value or zero means wait indefinitely (debug driven)
debugPauseSeconds: 5

# If true, regardless of the debugPauseSeconds, the agent will wake up on messages
# Useful for agents with long debugPauseSeconds, so that they can wake up and reply quickly
wakeOnMessage: false

# The maximum amount to spend on LLM interactions
# Once reached the agent will stop and this value will need to be increased to continue
spendLimitDollars: 2.00

# Command Protection: Useful for agents you want to restrict from modifying the system
#   None: Commands from the LLM run automatically, this is the default setting as well if the value is not set
#   Manual: Every command the LLM wants to run has to be approved [y/n]. Not very autonomous.
#   Auto: All commands are run through the separate LLM instace that will check to see if the command is safe
commandProtection: "none"

# Enable the `ns-session complete` command for this agent (default: false)
# When enabled, the agent can use `ns-session complete` to signal task completion, helping to avoid hanging waiting agents
completeSessionEnabled: true

# Run these commands on session start, in the example below the agent will see how to use mail and a list of other agents
initialCommands:
  - ns-users
  - ns-mail help

# Additional custom variables can be defined here and/or in the agent config to be loaded into the agent prompt
```

- Run `naisys <path to yaml or directory>`
  - If a yaml file is passed, naisys will start a single agent
  - If a directory is passed, naisys will start a tmux session with the screen split for each agent

## Using NAISYS

#### The Basics

- NAISYS will start with a debug prompt, this is where you can use and run commands in NAISYS just like the LLM will
- If you hit `Enter` without typing anything, the LLM will run against the prompt
- Afterwards NAISYS will return to the debug prompt
- Depending on how the agents' `debugPauseSeconds` is configured NAISYS will
  - Pause on the debug prompt for that many seconds
  - Pause indefinitely
  - Pause until a new message is received from another agent

#### Console Colors Legend

- Purple: Response from LLM, added to context
- White: Generated locally or from a real shell, added to context
- Green: Debug prompt and debug command reponses. Not added to context. Used for diagnostics between calls to LLM
- Red: High level NAISYS errors, not added to the context

#### Commands

- NAISYS tries to be light, acting as a helpful proxy between the LLM and a real shell, most commands should pass right though to the shell
- Debug Commands
  - `ns-cost` - Prints the current total LLM cost
  - `ns-context` - Prints the current context
  - `ns-talk` - Communicate with the local agent to give hints or ask questions (the agent itself does not know about talk and is directed to use `ns-comment` or `ns-mail` for communication)
  - `exit` - Exits NAISYS in debug mode. If the LLM tries to use `exit`, it is directed to use `ns-session compact/complete` instead
- Special Commands usable by the LLM as well as by the debug prompt
  - `ns-comment "<note>"` - The LLM is directed to use this for 'thinking out loud' which avoids 'invalid command' errors
  - `ns-session` - Session management commands:
    - `ns-session wait <seconds>` - Pause execution for a set number of seconds
    - `ns-session trim <indexes>` - Remove prompts by index to save tokens (e.g., "1-5, 8")
    - `ns-session compact "<note>"` - End session and start fresh with a note for the next session
    - `ns-session complete "<result>"` - Mark task as complete and exit (for sub-agents: notifies lead agent)
- NAISYS apps
  - `ns-mail` - A context friendly 'mail system' used for agent to agent communication
  - `ns-lynx` - A context friendly wrapping on the lynx browser that can use a separate LLM to reduce the size of a large webpage into something that can fit into the LLM's context
  - `ns-genimg "<description>" <filepath>` - Generates an image with the given description, save at the specified fully qualified path
  - `ns-agent` - A way for LLMs to start/stop their own sub-agents. Communicating with each other with `ns-mail`.

## Changelog

- 2.2: NAISYS cross machine support enabled by a new hub process
- 2.1: Monorepo architecture, allowing Supervisor to run in-process
- 2.0: Agent multiplexing in the same process
- 1.7: Prompt caching, ns-lynx pagination, complete task command
- 1.6: Support for long running shell commands and full screen terminal output
- 1.5: Allow agents to start their own parallel `subagents`
- 1.4: `ns-genimg` command for generating images
- 1.3: Post-session session compaction as well as a mail 'blackout' period
- 1.2: Created stand-in shell commands for custom Naisys commands
- 1.1: Added command protection settings to prevent unwanted writes
- 1.0: Initial release

## License

MIT

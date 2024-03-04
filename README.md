## NAISYS (Node.js Autonomous Intelligence System)

NAISYS is acts as a proxy shell between a LLM and a real shell. The goal is to see how far a LLM can
get into writing a website from scratch as well as work with other LLM agents on the same project. Trying to figure
out what works and what doesn't when it comes to 'cognitive architectures'. NAISYS isn't
limited to websites, but it seemed like a good place to start.

Since the LLM has a limited context, NAISYS should take this into account and help the LLM
perform 'context friendly' operations. For example reading/writing a file can't use a typical editor like
vim or nano so point the LLM to use cat to read/write files in a single operation.

#### Node.js is used to create a simple proxy shell environment for the LLM that

- NAISYS helps the LLM keep track of its current context size
- Gives the LLM the ability to 'reset' the context and carry over information to a new session/context
- Proxy commands to a real shell, and help guide the LLM to use context friendly commands
- Prevent the context from being polluted by catching common errors like output that includes the command prompt itself
- Allows communication with the LLM by way of a 'debug' prompt after each run of the LLM
- A custom 'mail' system for context friendly inter-agent communication
- A 'lynx' browser wrapper called 'llmynx' that uses a separate LLM to reduce the size of web pages to fit in the context
- Cost tracking built in, and cost limits must be set in the config to run NAISYS
- Supports multiple LLM backends, configurable per agent - Google, OpenAI, and self-hosted LLMs

## Resources

- [Website](https://naisys.org)
- [Discord](https://discord.gg/JBUPWSbaEt)
- [NPM Package](https://www.npmjs.com/package/naisys)

## Installation

#### Getting started locally

- Install Node.js, NAISYS has been tested with version 20
- Clone this repository
- Run `npm install` to install dependencies
- Create a `.env` from the `.env.example` file, and configure
- Run `npm run compile`
- Configure your agent using the examples in the `./agents` folder
- Run `node dist/naisys.js <path to agent yaml file>`

#### Notes for Windows users

- Install WSL (Windows Subsystem for Linux)
- The naisys/website folder should be set to the WSL path
  - So `C:\var\naisys` should be `/mnt/c/var/naisys` in the `.env` file
- If you want to use NAISYS for a website
  - Install a local web server, for example [XAMPP](https://www.apachefriends.org/) on Windows
  - Start the server and put the URL in the `.env` file

#### Getting started on a VM (Digital Ocean for example)

- Create new VM using the [LAMP stack droplet template](https://marketplace.digitalocean.com/apps/lamp)
- Login to the droplet using the web console
- Clone this repo using the [instructions from GitHub](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)
- Run `apt install lynx`
- Run `apt install npm`
- Install `nvm` using the `curl` url from these [instructions](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating)
  - Run `nvm install/use 20` to set node version to 20
- Create a `.env` from the `.env.example` file
  - Set the api keys for the LLMs you need to access
  - Set `NAISYS_FOLDER` to `/var/naisys`
- If you plan to use NAISYS for a website
  - Set `WEBSITE_FOLDER` to `/var/www/html`
  - Set `WEBSITE_URL` to the `http://<IP address of the droplet>`
- Follow the instructions for getting started locally above

## Using NAISYS

#### The Basics

- NAISYS will start with a debug prompt, this is where you can use and run commands in NAISYS just like the LLM will
- If you hit `Enter` without typing anything, the LLM will run against the prompt
- Afterwards NAISYS will return to the debug prompt
- Depending on how the agents' `debugPauseSeconds` is configured NAISYS will
  - Pause on the debug prompt for that many seconds
  - Pause indefinitely
  - Pause until a new message is received from another agent
- Combined logs across all agents are written to the `{WEBSITE_FOLDER}/logs` folder as html

#### Console Colors Legend

- Purple: Response from LLM, added to context
- White: Generated locally or from a real shell, added to context
- Green: Debug prompt and debug command reponses. Not added to context. Used for diagnostics between calls to LLM
- Red: High level NAISYS errors, not added to the context

#### Commands

- NAISYS tries to be light, acting as a helpful proxy between the LLM and a real shell, most commands should pass right though to the shell
- Debug Commands
  - `cost` - Prints the current total LLM cost
  - `context` - Prints the current context
  - `exit` - Exits NAISYS. If the LLM tries to use `exit`, it is directed to use `endsession` instead
  - `talk` - Communicate with the local agent to give hints or ask questions (the agent itself does not know about talk and is directed to use `comment` or `llmail` for communication)
- Special Commands usable by the LLM as well as by the debug prompt
  - `comment <notes>` - The LLM is directed to use this for 'thinking out loud' which avoid 'invalid command' errors
  - `endsession <notes>` - Clear the context and start a new session.
    - The LLM is directed to track it's context size and to end the session with a note before running over the context limit
  - `pause <seconds>` - Can be used by the debug agent or the LLM to pause execution indefinitely, or until a new message is received from another agent, or for a set number of seconds
- NAISYS apps
  - `llmail` - A context friendly 'mail system' used for agent to agent communication
  - `llmynx` - A context friendly wrapping on the lynx browser that can use a separate LLM to reduce the size of a large webpage into something that can fit into the LLM's context

## Code Design Notes

- The entry point is in `./naisys.ts`
- LLM configurations are in the `src/llm/llmModels.ts` file
- A helpful `dependency-graph.png` is included to get an idea of the overall architecture
  - This also doubles as a way to prevent cyclic dependencies as a DI library is not used currently
- The code is organzied into module based services
  - Think poor mans singleton dependency injection
  - A previous version had class based services using real DI, but made the code a soup of `this.` statements
  - Code from these services are imported with \* so it's clear when you're calling out to a service like llmService.send()
- There is a command loop that first checks for internally handled NAISYS commands, unhandled commands fall through to an actual shell
  - Multiline commands are added to a temporary shell script and then executed so it's easier to pinpoint where a command failed by line number in the script versus the entire shell log
- Various sqlite databases are used for logging, cost tracking and mail. All stored in the `{NAISYS_FOLDER}/lib` folder

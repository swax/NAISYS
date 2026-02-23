/**
 * Centralized command definitions.
 * Used by RegistrableCommand, per-command help output, and the MOTD
 * so names and descriptions stay in sync across the codebase.
 */

export interface SubcommandDef {
  usage: string;
  description: string;
}

export interface CommandDef {
  name: string;
  /** Inline usage hint shown in MOTD for commands without subcommands, e.g. '"<description>" <filepath>' */
  usage?: string;
  description: string;
  /** If true, command is only shown in debug mode */
  isDebug?: boolean;
  subcommands?: Record<string, SubcommandDef>;
}

// --- Feature commands ---

export const commentCmd: CommandDef = {
  name: "ns-comment",
  usage: '"<thought>"',
  description:
    "Any non-command output like thinking out loud, prefix with `ns-comment`",
};

export const lookCmd: CommandDef = {
  name: "ns-look",
  usage: "[--describe] <filepath>",
  description:
    "Look at an image by adding it to the context. Optional --describe to add only a text description instead",
};

export const listenCmd: CommandDef = {
  name: "ns-listen",
  usage: "[--transcribe] <filepath>",
  description:
    "Listen to audio by adding it to the context. Optional --transcribe to add only a text transcription instead",
};

export const genImgCmd: CommandDef = {
  name: "ns-genimg",
  usage: '"<description>" <filepath>',
  description:
    "Generate an image with the description and save it to the given file path",
};

export const lynxCmd: CommandDef = {
  name: "ns-lynx",
  description:
    "A context optimized web browser. Use `ns-lynx help` to learn how to use it",
  subcommands: {
    search: {
      usage: "search <query>",
      description: "Search Google for the given query",
    },
    open: {
      usage: "open <url>",
      description:
        "Open the given URL. Links are represented as [N] prefixed numbers",
    },
    follow: {
      usage: "follow <link number>",
      description:
        "Open the given link number. Link numbers work across all previous outputs",
    },
    links: {
      usage: "links <url> <page>",
      description:
        "List only the links for the given URL. Use the page number to get more links",
    },
    more: {
      usage: "more",
      description: "Show the next page of content from the last URL opened",
    },
  },
};

export const mailCmd: CommandDef = {
  name: "ns-mail",
  description: "A private mail system for communicating with your team",
  subcommands: {
    send: {
      usage: 'send "<users>" "<subject>" "<msg>" [file1 file2 ...]',
      description: "Send a message, optionally attach files",
    },
    list: {
      usage: "list [received|sent]",
      description: "List recent messages (non-archived, * = unread)",
    },
    read: {
      usage: "read <id>",
      description: "Read a message (marks as read)",
    },
    archive: {
      usage: "archive <ids>",
      description: "Archive messages (comma-separated)",
    },
    search: {
      usage: "search <terms> [-archived] [-subject]",
      description: "Search messages",
    },
  },
};

export const chatCmd: CommandDef = {
  name: "ns-chat",
  description: "Quick back-and-forth chat with your team",
  subcommands: {
    send: {
      usage: 'send "<users>" "<msg>" [file1 file2 ...]',
      description: "Send a chat message, optionally attach files",
    },
    recent: {
      usage: 'recent ["<users>"] [skip] [take]',
      description:
        "Show recent chat messages, optionally filtered by user(s) (* = unread)",
    },
  },
};

export const sessionCmd: CommandDef = {
  name: "ns-session",
  description: "Manage session (compact, wait, or complete)",
  subcommands: {
    wait: {
      usage: "wait <seconds>",
      description:
        "Pause and wait. Will auto-wake for new mail or other events.",
    },
    compact: {
      usage: "compact",
      description:
        "Compact the session which will reset the token count. The next session will run a restore command to continue.",
    },
    complete: {
      usage: 'complete "<result>"',
      description:
        "Complete the session with a result message. Make sure to notify who you need to with results before completing.",
    },
  },
};

export const subagentCmd: CommandDef = {
  name: "ns-agent",
  description: "Spawn and manage sub-agents",
  subcommands: {
    list: {
      usage: "list",
      description: "List your subagents and their status",
    },
    start: {
      usage: 'start <name> "<task>"',
      description: "Start agent by name with a task description",
    },
    stop: {
      usage: "stop <name>",
      description: "Stop an agent by name",
    },
    local: {
      usage: "!local",
      description: "List agents running locally in this process",
    },
    switch: {
      usage: "!switch <name>",
      description: "Switch session to a local running agent",
    },
    peek: {
      usage: "!peek <name>",
      description: "Show the last 10 lines from a local agent's output",
    },
  },
};

export const usersCmd: CommandDef = {
  name: "ns-users",
  description: "Display a list of users in the organization",
};

export const workspaceCmd: CommandDef = {
  name: "ns-workspace",
  description:
    "Pin files to the session so you always see the latest file contents",
  subcommands: {
    add: {
      usage: "add <filepath>",
      description: "Add a file to the workspace (contents shown in context)",
    },
    remove: {
      usage: "remove <filepath>",
      description: "Remove a file from the workspace",
    },
    list: {
      usage: "list",
      description: "List all tracked files",
    },
    clear: {
      usage: "clear",
      description: "Remove all files from the workspace",
    },
  },
};

// --- Debug commands ---

export const agentConfigCmd: CommandDef = {
  name: "ns-agent-config",
  description:
    "View or update agent config (update only lasts for current session)",
  isDebug: true,
};

export const costCmd: CommandDef = {
  name: "ns-cost",
  description: "Show token usage and cost tracking",
  isDebug: true,
};

export const contextCmd: CommandDef = {
  name: "ns-context",
  description: "Print the current LLM context",
  isDebug: true,
};

export const hostCmd: CommandDef = {
  name: "ns-host",
  description: "List all known hosts and their status",
  isDebug: true,
};

export const hubCmd: CommandDef = {
  name: "ns-hub",
  description: "Show hub connection status",
  isDebug: true,
};

export const superadminPasswordCmd: CommandDef = {
  name: "ns-superadmin-password",
  description: "Change the superadmin's password",
  isDebug: true,
};

export const talkCmd: CommandDef = {
  name: "ns-talk",
  description: "Send a message to the agent",
  isDebug: true,
};

// --- Built-in commands ---

export const helpCmd: CommandDef = {
  name: "ns-help",
  description: "Show available commands",
};

export const exitCmd: CommandDef = {
  name: "exit",
  description: "Exit the application",
  isDebug: true,
};

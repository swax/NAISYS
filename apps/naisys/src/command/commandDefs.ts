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
  /** Alternative names that also invoke this command */
  aliases?: string[];
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

export const desktopCmd: CommandDef = {
  name: "ns-desktop",
  description: "Desktop interaction commands",
  subcommands: {
    screenshot: {
      usage: "screenshot",
      description:
        "Capture the current LLM-view screenshot and add it to context",
    },
    dump: {
      usage: "dump",
      description:
        "Save diagnostic desktop screenshots to the screenshots folder, including full and focused variants",
    },
    focus: {
      usage: "focus [clear|<x> <y> <width> <height>]",
      description:
        "Set or clear the desktop focus rectangle in current screenshot coordinates. Screenshots and coordinates become relative to that viewport",
    },
    key: {
      usage: "key <combo>",
      description:
        "Send a manual key combo or sequence (e.g. enter, escape, ctrl+c, alt+tab, up up right)",
    },
    hold: {
      usage: "hold <combo> <ms>",
      description:
        "Hold a key (or chord) down for the given milliseconds - default key press is 100ms",
    },
    click: {
      usage: "click <x> <y> [left|right|middle|double|triple]",
      description:
        "Click at current screenshot coordinates (defaults to left). Use 'double' or 'triple' for multi-click",
    },
    type: {
      usage: 'type "<text>"',
      description: "Type text at the current cursor position",
    },
    move: {
      usage: "move <x> <y>",
      description:
        "Move the mouse cursor to the given screenshot coordinates without clicking",
    },
    scroll: {
      usage: "scroll <x> <y> <up|down|left|right> <amount>",
      description:
        "Scroll the wheel at the given screenshot coordinates by the given number of clicks",
    },
    drag: {
      usage: "drag <x1> <y1> <x2> <y2>",
      description:
        "Press the left mouse button at (x1, y1), drag to (x2, y2), then release",
    },
    wait: {
      usage: "wait [seconds]",
      description:
        "Pause to let the UI settle (animations, page loads). Defaults to 5 seconds",
    },
  },
};

export const browserCmd: CommandDef = {
  name: "ns-browser",
  description:
    "A headless browser that has both text based and visual modes",
  subcommands: {
    open: {
      usage: "open <url>",
      description:
        "Navigate to a URL. Visual mode returns a screenshot, text mode returns the accessibility tree",
    },
    back: {
      usage: "back",
      description: "Navigate back in history",
    },
    forward: {
      usage: "forward",
      description: "Navigate forward in history",
    },
    reload: {
      usage: "reload",
      description: "Reload the current page",
    },
    close: {
      usage: "close",
      description: "Close the current page to free memory",
    },
    mode: {
      usage: "mode [visual|text]",
      description:
        "Switch between visual mode (screenshot + coord-based clicks, default) and text mode (accessibility tree + selectors)",
    },
    screenshot: {
      usage: "screenshot",
      description:
        "Capture a screenshot of the current page and add it to context (requires a vision-capable model)",
    },
    click: {
      usage: 'click <x> <y> [left|right|middle|double] | click "<selector>"',
      description:
        "Visual mode: click at screenshot coordinates. Text mode: click element by selector (e.g. text=Submit, #login, .btn)",
    },
    scroll: {
      usage: "scroll <up|down|left|right> <pixels>",
      description: "Visual mode only: scroll the viewport by the given pixels",
    },
    type: {
      usage: 'type "<text>"',
      description: "Type text into the focused element",
    },
    key: {
      usage: "key <combo>",
      description:
        "Press a key combo (e.g. enter, tab, escape, ctrl+a). Useful for form submission and navigation",
    },
    fill: {
      usage: 'fill "<selector>" "<text>"',
      description:
        "Text mode only: fill an input element matched by selector with the given text",
    },
    text: {
      usage: "text",
      description: "Dump the current page's accessibility tree (paginated)",
    },
    more: {
      usage: "more",
      description: "Show the next page of paginated content from `text`",
    },
  },
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
      description: "Send a message (subject and msg are separate quoted args)",
    },
    inbox: {
      usage: "inbox",
      description: "List received messages (non-archived, * = unread)",
    },
    outbox: {
      usage: "outbox",
      description: "List sent messages (non-archived)",
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
      description: "Compact the session which will reset the token count.",
    },
    complete: {
      usage: 'complete "<result>"',
      description:
        "Complete the session, result will be mailed to the lead agent or admin.",
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
      usage: "stop [-r] <name>",
      description:
        "Stop an agent by name. Use -r to recursively stop subordinate agents",
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
      usage: "peek <name> [skip] [take]",
      description: "Peek at an agent's output buffer",
    },
  },
};

export const usersCmd: CommandDef = {
  name: "ns-users",
  usage: "[username]",
  description:
    "Display relevant users: superiors, peers, subordinates, and top-level agents. Optionally specify a username for their perspective",
};

export const ptyCmd: CommandDef = {
  name: "ns-pty",
  usage: "<command...>",
  description:
    "Run a command in a pseudo-terminal. Use for commands that need an interactive prompt (sudo, ssh, passwd). Linux only",
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
  name: "ns-config",
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

export const talkCmd: CommandDef = {
  name: "ns-talk",
  aliases: ["@"],
  description: "Send a message to the agent",
  isDebug: true,
};

export const cmdCmd: CommandDef = {
  name: "ns-cmd",
  aliases: ["!"],
  usage: "<command>",
  description:
    "Run a command as if the LLM had typed it (input and output are added to context). Shortcut: !<command>",
  isDebug: true,
};

export const pauseCmd: CommandDef = {
  name: "ns-pause",
  description:
    "Toggle the loop's pause state locally (reproduces remote pause)",
  isDebug: true,
  subcommands: {
    on: { usage: "on", description: "Pause the loop" },
    off: { usage: "off", description: "Resume the loop" },
  },
};

// --- Built-in commands ---

export const helpCmd: CommandDef = {
  name: "ns-help",
  description: "Show available commands",
};

export const exitCmd: CommandDef = {
  name: "exit",
  usage: "[all]",
  description:
    "Exit the current agent. Use 'exit all' to exit all agents, ending the application",
  isDebug: true,
};

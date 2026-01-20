/**
 * Registry pattern for NAISYS commands.
 * Each service exports its command metadata and handler function.
 */

export enum NextCommandAction {
  Continue,
  CompactSession,
  ExitApplication,
}

export interface NextCommandResponse {
  nextCommandAction: NextCommandAction;
  pauseSeconds: number;
  wakeOnMessage: boolean;
}

/**
 * Response from a command handler.
 * Can be a simple string or an object with additional control flow info.
 */
export interface CommandResponse {
  /** Content to append to context */
  content: string;
  /** If set, the command handler will return this response directly */
  nextCommandResponse?: NextCommandResponse;
}

/**
 * A command that can be registered in the command registry.
 * The handler returns either a string or CommandResponse to be appended to context.
 */
export interface RegistrableCommand {
  /** The command name, e.g., "ns-lynx" */
  commandName: string;

  /** Handler function that processes the command and returns a response */
  handleCommand: (cmdArgs: string) => Promise<string | CommandResponse>;
}

/**
 * Creates a command registry from an array of registrable commands.
 * The registry provides O(1) lookup by command name.
 */
export function createCommandRegistry(commands: RegistrableCommand[]) {
  const registry = new Map<string, RegistrableCommand>();

  // Add built-in ns-help command
  const helpCommand: RegistrableCommand = {
    commandName: "ns-help",
    handleCommand: () => {
      const commandNames = Array.from(registry.keys()).sort();
      return Promise.resolve("Available NAISYS commands:\n" + commandNames.map((name) => `  ${name}`).join("\n"));
    },
  };
  registry.set(helpCommand.commandName, helpCommand);

  for (const command of commands) {
    if (registry.has(command.commandName)) {
      throw new Error(
        `Duplicate command registration: ${command.commandName}`,
      );
    }
    registry.set(command.commandName, command);
  }

  function get(commandName: string): RegistrableCommand | undefined {
    return registry.get(commandName);
  }

  function has(commandName: string): boolean {
    return registry.has(commandName);
  }

  return {
    get,
    has,
  };
}

export type CommandRegistry = ReturnType<typeof createCommandRegistry>;

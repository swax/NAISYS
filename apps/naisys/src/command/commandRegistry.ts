/**
 * Registry pattern for NAISYS commands.
 * Each service exports its command metadata and handler function.
 */

/**
 * Response from a command handler.
 * Can be a simple string or an object with additional control flow info.
 */
export interface CommandResponse {
  /** Content to append to context */
  content: string;
  /** Optional pause duration in seconds (e.g., for mail wait) */
  pauseSeconds?: number;
  /** Whether to wake on incoming message during pause */
  wakeOnMessage?: boolean;
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

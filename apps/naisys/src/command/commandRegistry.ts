/**
 * Registry pattern for NAISYS commands.
 * Each service exports its command metadata and handler function.
 */

import { InputModeService } from "../utils/inputMode.js";

export enum NextCommandAction {
  Continue,
  CompactSession,
  ExitApplication,
}

export interface NextCommandResponse {
  nextCommandAction: NextCommandAction;
  /** 0 means no wait, and -1 means wait indefinitely until a wake event occurs */
  pauseSeconds?: number;
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

  /** Brief description shown in ns-help */
  helpText?: string;

  /** If true, command is shown in debug section of ns-help */
  isDebug?: boolean;

  /** Handler function that processes the command and returns a response */
  handleCommand: (
    cmdArgs: string,
  ) => string | CommandResponse | Promise<string | CommandResponse>;
}

/**
 * Creates a command registry from an array of registrable commands.
 * The registry provides O(1) lookup by command name.
 */
export function createCommandRegistry(
  inputMode: InputModeService,
  commands: RegistrableCommand[],
) {
  const registry = new Map<string, RegistrableCommand>();

  // Add built-in ns-help command
  const helpCommand: RegistrableCommand = {
    commandName: "ns-help",
    helpText: "Show available commands",
    handleCommand: () => {
      const allCommands = Array.from(registry.values()).sort((a, b) =>
        a.commandName.localeCompare(b.commandName),
      );

      const mainCommands = allCommands.filter((c) => !c.isDebug);
      const debugCommands = allCommands.filter((c) => c.isDebug);

      const formatTable = (cmds: RegistrableCommand[]) => {
        const rows = [...cmds.map((c) => [c.commandName, c.helpText || ""])];
        const colWidths = rows[0].map((_, i) =>
          Math.max(...rows.map((r) => r[i].length)),
        );
        return rows
          .map((row) =>
            row.map((cell, i) => cell.padEnd(colWidths[i])).join("  "),
          )
          .join("\n");
      };

      let output = "Commands:\n" + formatTable(mainCommands);
      if (inputMode.isDebug() && debugCommands.length > 0) {
        output += "\n\nDebug commands:\n" + formatTable(debugCommands);
      }

      return output;
    },
  };
  registry.set(helpCommand.commandName, helpCommand);

  for (const command of commands) {
    if (registry.has(command.commandName)) {
      throw new Error(`Duplicate command registration: ${command.commandName}`);
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

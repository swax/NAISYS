/**
 * Registry pattern for NAISYS commands.
 * Each service exports its command metadata and handler function.
 */

import type { InputModeService } from "../utils/inputMode.js";
import type { CommandDef } from "./commandDefs.js";
import { helpCmd } from "./commandDefs.js";

export enum NextCommandAction {
  Continue,
  CompactSession,
  ExitApplication,
  SessionComplete,
}

export type WaitBehavior =
  | { kind: "none" }
  | { kind: "timed"; seconds: number }
  | { kind: "indefinite" };

export function noWait(): WaitBehavior {
  return { kind: "none" };
}

export function timedWait(seconds: number): WaitBehavior {
  return seconds > 0 ? { kind: "timed", seconds } : noWait();
}

export function indefiniteWait(): WaitBehavior {
  return { kind: "indefinite" };
}

export function isTimedWait(
  wait: WaitBehavior | undefined,
): wait is Extract<WaitBehavior, { kind: "timed" }> {
  return wait?.kind === "timed";
}

export interface NextCommandResponse {
  nextCommandAction: NextCommandAction;
  /** Explicit wait behavior before the next iteration. Omit to use the mode default. */
  wait?: WaitBehavior;
  /** If true, switch to LLM mode for a follow-up response. Also breaks
   *  pause — a command that needs an LLM response should get one even if
   *  the operator has the session paused. */
  triggerLlm?: boolean;
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
  command: CommandDef;

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
    command: helpCmd,
    handleCommand: () => {
      const allCommands = Array.from(new Set(registry.values())).sort((a, b) =>
        a.command.name.localeCompare(b.command.name),
      );

      const mainCommands = allCommands.filter((c) => !c.command.isDebug);
      const debugCommands = allCommands.filter((c) => c.command.isDebug);

      const formatTable = (cmds: RegistrableCommand[]) => {
        const rows = [
          ...cmds.map((c) => {
            const aliases = c.command.aliases?.length
              ? ` (${c.command.aliases.join(", ")})`
              : "";
            return [c.command.name + aliases, c.command.description || ""];
          }),
        ];
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
        output +=
          "\n\nDebug commands: (Not visible to LLM)\n" +
          formatTable(debugCommands);
      }

      return output;
    },
  };
  registry.set(helpCommand.command.name, helpCommand);

  for (const command of commands) {
    if (registry.has(command.command.name)) {
      throw new Error(
        `Duplicate command registration: ${command.command.name}`,
      );
    }
    registry.set(command.command.name, command);

    for (const alias of command.command.aliases ?? []) {
      if (registry.has(alias)) {
        throw new Error(`Duplicate command registration: ${alias}`);
      }
      registry.set(alias, command);
    }
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

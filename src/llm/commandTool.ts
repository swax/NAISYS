import { Type } from "@google/genai";
import { createConfig } from "../config.js";

export function createCommandTools(
  config: Awaited<ReturnType<typeof createConfig>>,
) {
  const escapedQuoteRegex = /"/g;
  const escapedBackslashRegex = /\\/g;

  const multipleCommandsDisabled = !!config.agent.disableMultipleCommands;

  // Common description strings
  const COMMENT_DESCRIPTION =
    "High level commentary and/or reasoning. Use an empty string if no comment is required.";
  const SINGLE_COMMAND_DESCRIPTION =
    "Single Shell or NAISYS command to execute next.";
  const COMMAND_LIST_DESCRIPTION =
    "Ordered list of shell or NAISYS commands to execute next.";
  const TOOL_DESCRIPTION =
    "Return the commands to run next along with an optional comment explaining the plan.";

  const commandProperties = multipleCommandsDisabled
    ? {
        comment: {
          type: "string",
          description: COMMENT_DESCRIPTION,
        },
        command: {
          type: "string",
          description: SINGLE_COMMAND_DESCRIPTION,
        },
      }
    : {
        comment: {
          type: "string",
          description: COMMENT_DESCRIPTION,
        },
        commandList: {
          type: "array",
          description: COMMAND_LIST_DESCRIPTION,
          items: {
            type: "string",
          },
        },
      };

  const requiredProperties = multipleCommandsDisabled
    ? ["comment", "command"]
    : ["comment", "commandList"];

  const consoleToolOpenAI = {
    type: "function" as const,
    function: {
      name: "submit_commands",
      description: TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: commandProperties,
        required: requiredProperties,
      },
    },
  };

  // Anthropic-compatible tool definition
  const consoleToolAnthropic = {
    name: "submit_commands",
    description: TOOL_DESCRIPTION,
    input_schema: {
      type: "object" as const,
      properties: commandProperties,
      required: requiredProperties,
    },
  };

  // Google-compatible tool definition
  const googleCommandProperties = multipleCommandsDisabled
    ? {
        comment: {
          type: Type.STRING,
          description: COMMENT_DESCRIPTION,
        },
        command: {
          type: Type.STRING,
          description: SINGLE_COMMAND_DESCRIPTION,
        },
      }
    : {
        comment: {
          type: Type.STRING,
          description: COMMENT_DESCRIPTION,
        },
        commandList: {
          type: Type.ARRAY,
          description: COMMAND_LIST_DESCRIPTION,
          items: {
            type: Type.STRING,
          },
        },
      };

  const consoleToolGoogle = {
    name: "submit_commands",
    description: TOOL_DESCRIPTION,
    parameters: {
      type: Type.OBJECT,
      properties: googleCommandProperties,
      required: requiredProperties,
    },
  };

  function getCommandsFromOpenAiToolUse(
    toolCalls: unknown,
  ): string[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return undefined;
    }

    for (const toolCall of toolCalls) {
      if (!toolCall || typeof toolCall !== "object") {
        continue;
      }

      const toolType = (toolCall as { type?: string }).type;

      if (toolType !== "function") {
        continue;
      }

      const functionCall = (
        toolCall as {
          function?: { name?: string; arguments?: unknown };
        }
      ).function;

      if (!functionCall || typeof functionCall !== "object") {
        continue;
      }

      if (functionCall.name !== consoleToolOpenAI.function.name) {
        continue;
      }

      if (typeof functionCall.arguments !== "string") {
        continue;
      }

      let parsedArgs: unknown;

      try {
        parsedArgs = JSON.parse(functionCall.arguments);
      } catch {
        continue;
      }

      if (!parsedArgs || typeof parsedArgs !== "object") {
        continue;
      }

      const comment = (parsedArgs as { comment?: unknown }).comment;
      const commandList = (parsedArgs as { commandList?: unknown }).commandList;
      const command = (parsedArgs as { command?: unknown }).command;

      const commands: string[] = [];

      if (typeof comment === "string" && comment.trim()) {
        commands.push(buildCommentCommand(comment.trim()));
      }

      if (multipleCommandsDisabled) {
        if (typeof command === "string" && command.trim()) {
          commands.push(command.trim());
        }
      } else if (Array.isArray(commandList)) {
        for (const command of commandList) {
          if (typeof command === "string" && command.trim()) {
            commands.push(command.trim());
          }
        }
      }

      if (commands.length) {
        return commands;
      }
    }

    return undefined;
  }

  function getCommandsFromAnthropicToolUse(
    contentBlocks: unknown,
  ): string[] | undefined {
    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
      return undefined;
    }

    for (const block of contentBlocks) {
      if (!block || typeof block !== "object") {
        continue;
      }

      const blockType = (block as { type?: string }).type;

      if (blockType !== "tool_use") {
        continue;
      }

      const toolUse = block as {
        name?: string;
        input?: unknown;
      };

      if (toolUse.name !== consoleToolAnthropic.name) {
        continue;
      }

      const input = toolUse.input;

      if (!input || typeof input !== "object") {
        continue;
      }

      const comment = (input as { comment?: unknown }).comment;
      const commandList = (input as { commandList?: unknown }).commandList;
      const command = (input as { command?: unknown }).command;

      const commands: string[] = [];

      if (typeof comment === "string" && comment.trim()) {
        commands.push(buildCommentCommand(comment.trim()));
      }

      if (multipleCommandsDisabled) {
        if (typeof command === "string" && command.trim()) {
          commands.push(command.trim());
        }
      } else if (Array.isArray(commandList)) {
        for (const command of commandList) {
          if (typeof command === "string" && command.trim()) {
            commands.push(command.trim());
          }
        }
      }

      if (commands.length) {
        return commands;
      }
    }

    return undefined;
  }

  function getCommandsFromGoogleToolUse(
    functionCalls: unknown,
  ): string[] | undefined {
    if (!Array.isArray(functionCalls) || functionCalls.length === 0) {
      return undefined;
    }

    for (const functionCall of functionCalls) {
      if (!functionCall || typeof functionCall !== "object") {
        continue;
      }

      const name = (functionCall as { name?: string }).name;
      const args = (functionCall as { args?: unknown }).args;

      if (name !== consoleToolGoogle.name) {
        continue;
      }

      if (!args || typeof args !== "object") {
        continue;
      }

      const comment = (args as { comment?: unknown }).comment;
      const commandList = (args as { commandList?: unknown }).commandList;
      const command = (args as { command?: unknown }).command;

      const commands: string[] = [];

      if (typeof comment === "string" && comment.trim()) {
        commands.push(buildCommentCommand(comment.trim()));
      }

      if (multipleCommandsDisabled) {
        if (typeof command === "string" && command.trim()) {
          commands.push(command.trim());
        }
      } else if (Array.isArray(commandList)) {
        for (const command of commandList) {
          if (typeof command === "string" && command.trim()) {
            commands.push(command.trim());
          }
        }
      }

      if (commands.length) {
        return commands;
      }
    }

    return undefined;
  }

  function buildCommentCommand(comment: string): string {
    const escaped = comment
      .replace(escapedBackslashRegex, "\\\\")
      .replace(escapedQuoteRegex, '\\"');

    return `comment "${escaped}"`;
  }

  return {
    consoleToolOpenAI,
    consoleToolAnthropic,
    consoleToolGoogle,
    getCommandsFromOpenAiToolUse,
    getCommandsFromAnthropicToolUse,
    getCommandsFromGoogleToolUse,
  };
}

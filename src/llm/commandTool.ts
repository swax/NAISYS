import * as config from "../config.js";

const escapedQuoteRegex = /"/g;
const escapedBackslashRegex = /\\/g;

const multipleCommandsDisabled = !!config.agent.disableMultipleCommands;

const commandProperties = multipleCommandsDisabled
  ? {
      comment: {
        type: "string",
        description:
          "High level commentary and/or resoning. Use an empty string if no comment is required.",
      },
      command: {
        type: "string",
        description: "Single Shell or NAISYS command to execute next.",
      },
    }
  : {
      comment: {
        type: "string",
        description:
          "High level commentary and/or resoning. Use an empty string if no comment is required.",
      },
      commandList: {
        type: "array",
        description:
          "Ordered list of shell or NAISYS commands to execute next.",
        items: {
          type: "string",
        },
      },
    };

const requiredProperties = multipleCommandsDisabled
  ? ["comment", "command"]
  : ["comment", "commandList"];

export const consoleToolOpenAI = {
  type: "function" as const,
  function: {
    name: "submit_commands",
    description:
      "Return the commands to run next along with an optional comment explaining the plan.",
    parameters: {
      type: "object",
      properties: commandProperties,
      required: requiredProperties,
    },
  },
};

// Anthropic-compatible tool definition
export const consoleToolAnthropic = {
  name: "submit_commands",
  description:
    "Return the commands to run next along with an optional comment explaining the plan.",
  input_schema: {
    type: "object" as const,
    properties: commandProperties,
    required: requiredProperties,
  },
};

export function getCommandsFromOpenAiToolUse(toolCalls: unknown): string[] | undefined {
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

    const functionCall = (toolCall as {
      function?: { name?: string; arguments?: unknown };
    }).function;

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

export function getCommandsFromAnthropicToolUse(contentBlocks: unknown): string[] | undefined {
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

function buildCommentCommand(comment: string): string {
  const escaped = comment
    .replace(escapedBackslashRegex, "\\\\")
    .replace(escapedQuoteRegex, '\\"');

  return `comment "${escaped}"`;
}

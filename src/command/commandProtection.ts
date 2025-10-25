import * as config from "../config.js";
import { LlmRole } from "../llm/llmDtos.js";
import { createLLMService } from "../llm/llmService.js";
import { CommandProtection } from "../utils/enums.js";
import { createOutputService } from "../utils/output.js";
import { createPromptBuilder } from "./promptBuilder.js";

interface ValidateCommandResponse {
  commandAllowed: boolean;
  rejectReason?: string;
}

export function createCommandProtection(
  promptBuilder: ReturnType<typeof createPromptBuilder>,
  llmService: ReturnType<typeof createLLMService>,
  output: ReturnType<typeof createOutputService>,
) {
  async function validateCommand(
    command: string,
  ): Promise<ValidateCommandResponse> {
    switch (config.agent.commandProtection) {
      case CommandProtection.None:
        return {
          commandAllowed: true,
        };
      case CommandProtection.Manual: {
        const confirmation = await promptBuilder.getCommandConfirmation();
        const commandAllowed = confirmation.toLowerCase() === "y";
        return {
          commandAllowed,
          rejectReason: commandAllowed ? undefined : "Command denied by admin",
        };
      }
      case CommandProtection.Auto:
        return await autoValidateCommand(command);
      default:
        throw "Write protection not configured correctly";
    }
  }

  async function autoValidateCommand(
    command: string,
  ): Promise<ValidateCommandResponse> {
    output.comment("Checking if command is allowed...");

    const systemMessage = `You are a command validator that checks if shell commands are ok to run.
The user is 'junior admin' allowed to move around the system, anywhere, and read anything, list anything.
They are not allowed to execute programs that could modify the system.
Programs that just give information responses are ok.
The user is allowed to write to their home directory in ${config.naisysFolder}/home/${config.agent.username}
In addition to the commands you know are ok, these additional commands are whitelisted: 
  llmail, llmynx, comment, endsession, and pause
Reply with 'allow' to allow the command, otherwise you can give a reason for your rejection.`;

    const response = await llmService.query(
      config.agent.shellModel,
      systemMessage,
      [
        {
          role: LlmRole.User,
          content: command,
        },
      ],
      "write-protection",
    );

    const commandAllowed = response[0].toLocaleLowerCase().startsWith("allow");

    return {
      commandAllowed,
      rejectReason: commandAllowed
        ? undefined
        : "Command Rejected: " + response,
    };
  }
  return {
    validateCommand,
  };
}

import { GlobalConfig } from "../globalConfig.js";
import { AgentConfig } from "../agent/agentConfig.js";
import { LlmRole } from "../llm/llmDtos.js";
import { LLMService } from "../llm/llmService.js";
import { CommandProtection as CommandProtectionEnum } from "../utils/enums.js";
import { OutputService } from "../utils/output.js";
import { PromptBuilder } from "./promptBuilder.js";

interface ValidateCommandResponse {
  commandAllowed: boolean;
  rejectReason?: string;
}

export function createCommandProtection(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  promptBuilder: PromptBuilder,
  llmService: LLMService,
  output: OutputService,
) {
  async function validateCommand(
    command: string,
  ): Promise<ValidateCommandResponse> {
    switch (agentConfig().commandProtection) {
      case CommandProtectionEnum.None:
        return {
          commandAllowed: true,
        };
      case CommandProtectionEnum.Manual: {
        const confirmation = await promptBuilder.getCommandConfirmation();
        const commandAllowed = confirmation.toLowerCase() === "y";
        return {
          commandAllowed,
          rejectReason: commandAllowed ? undefined : "Command denied by admin",
        };
      }
      case CommandProtectionEnum.Auto:
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
The user is allowed to write to their home directory in ${globalConfig().naisysFolder}/home/${agentConfig().username}
In addition to the commands you know are ok, these additional commands are whitelisted:
  ns-mail, llmynx, comment, endsession, and pause
Reply with 'allow' to allow the command, otherwise you can give a reason for your rejection.`;

    const response = await llmService.query(
      agentConfig().shellModel,
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

export type CommandProtection = ReturnType<typeof createCommandProtection>;

import { AgentConfig } from "../agent/agentConfig.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { LogService } from "../services/logService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { ContentSource, LlmMessage, LlmRole } from "./llmDtos.js";

export function createContextManager(
  { agentConfig }: AgentConfig,
  workspaces: WorkspacesFeature,
  systemMessage: string,
  output: OutputService,
  logService: LogService,
  inputMode: InputModeService,
) {
  let _messages: LlmMessage[] = [];

  clear();

  async function append(
    content: string,
    source: ContentSource = ContentSource.Console,
  ) {
    if (!content) {
      return;
    }

    // Debug runs in a shadow mode where their activity is not recorded in the context
    // Mark with a # to make it clear that it is not part of the context
    if (inputMode.isDebug()) {
      output.comment(content);
      return;
    }

    // Else otherwise we're running in LLM mode
    const role =
      source == ContentSource.ConsolePrompt || source == ContentSource.Console
        ? LlmRole.User
        : source == ContentSource.LlmPromptResponse ||
            source == ContentSource.LLM
          ? LlmRole.Assistant
          : undefined;

    if (!role) {
      throw new Error("Invalid source");
    }

    // Prompts are manually added to the console log
    if (
      source != ContentSource.ConsolePrompt &&
      source != ContentSource.LlmPromptResponse
    ) {
      output.write(
        content,
        source == "llm" ? OutputColor.llm : OutputColor.console,
      );
    }

    const llmMessage = <LlmMessage>{ source, role, content };
    _messages.push(llmMessage);

    // Log the message
    logService.write(llmMessage);
  }

  function clear() {
    _messages = [];
  }

  function getTokenCount() {
    const sytemMessageTokens = utilities.getTokenCount(systemMessage);
    const workspaceTokens = utilities.getTokenCount(getWorkspaceContent());

    return _messages.reduce((acc, message) => {
      return acc + utilities.getTokenCount(message.content);
    }, sytemMessageTokens + workspaceTokens);
  }

  /** Combine message list with adjacent messages of the same role role combined */
  function getCombinedMessages() {
    const combinedMessages: LlmMessage[] = [];
    let lastMessage: LlmMessage | undefined;

    for (const message of _messages) {
      if (lastMessage && lastMessage.role == message.role) {
        lastMessage.content += `\n${message.content}`;
      } else {
        const clonedMsg = { ...message };
        combinedMessages.push(clonedMsg);
        lastMessage = clonedMsg;
      }
    }

    // Append workspace content at the end (for prompt cache stability)
    const workspaceContent = getWorkspaceContent();
    if (workspaceContent) {
      if (lastMessage && lastMessage.role == LlmRole.User) {
        // Combine with the last user message
        lastMessage.content = `${workspaceContent}\n${lastMessage.content}`;
      } else {
        // Add as a new user message
        combinedMessages.push({
          source: ContentSource.Console,
          role: LlmRole.User,
          content: workspaceContent,
        });
      }
    }

    // Add cache points, role checks are sanity checks
    const beforeWorkspaceMsg = combinedMessages[combinedMessages.length - 2];
    if (
      agentConfig().workspacesEnabled &&
      beforeWorkspaceMsg &&
      beforeWorkspaceMsg.role === LlmRole.Assistant
    ) {
      beforeWorkspaceMsg.cachePoint = true;
    }

    const latestPromptMsg = combinedMessages[combinedMessages.length - 1];
    if (latestPromptMsg && latestPromptMsg.role === LlmRole.User) {
      latestPromptMsg.cachePoint = true;
    }

    return combinedMessages;
  }

  const exportedForTesting = {
    getMessages: () => _messages,
  };

  function getWorkspaceContent() {
    if (agentConfig().workspacesEnabled) {
      return workspaces.getContext();
    } else {
      return "";
    }
  }

  return {
    append,
    clear,
    getTokenCount,
    getCombinedMessages,
    exportedForTesting,
  };
}

export type ContextManager = ReturnType<typeof createContextManager>;

import { AgentConfig } from "../agent/agentConfig.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { LogService } from "../services/logService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { ContentBlock, ContentSource, LlmMessage, LlmRole } from "./llmDtos.js";

export function createContextManager(
  { agentConfig }: AgentConfig,
  workspaces: WorkspacesFeature,
  systemMessage: string,
  output: OutputService,
  logService: LogService,
  inputMode: InputModeService,
) {
  let messages: LlmMessage[] = [];

  // Actual messages token count from last API response
  let lastKnownTokenCount = 0;
  // Message index at the time lastKnownTokenCount was set
  let lastKnownMessageIndex = 0;

  clear();

  function append(
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
    messages.push(llmMessage);

    // Log the message
    logService.write(llmMessage);
  }

  function appendImage(base64: string, mimeType: string, filepath: string) {
    if (inputMode.isDebug()) {
      output.comment(`[Image: ${filepath}]`);
      return;
    }

    const contentBlocks: ContentBlock[] = [
      { type: "text", text: filepath },
      { type: "image", base64, mimeType },
    ];

    const llmMessage: LlmMessage = {
      source: ContentSource.Console,
      role: LlmRole.User,
      content: contentBlocks,
    };

    messages.push(llmMessage);

    // Log text only — pass filepath for hub attachment upload
    logService.write(llmMessage, filepath);

    // Display placeholder to console
    output.write(`[Image: ${filepath}]`, OutputColor.console);
  }

  function appendAudio(base64: string, mimeType: string, filepath: string) {
    if (inputMode.isDebug()) {
      output.comment(`[Audio: ${filepath}]`);
      return;
    }

    const contentBlocks: ContentBlock[] = [
      { type: "text", text: filepath },
      { type: "audio", base64, mimeType },
    ];

    const llmMessage: LlmMessage = {
      source: ContentSource.Console,
      role: LlmRole.User,
      content: contentBlocks,
    };

    messages.push(llmMessage);

    // Log text only — pass filepath for hub attachment upload
    logService.write(llmMessage, filepath);

    // Display placeholder to console
    output.write(`[Audio: ${filepath}]`, OutputColor.console);
  }

  function clear() {
    messages = [];
    lastKnownTokenCount = 0;
    lastKnownMessageIndex = 0;
  }

  /** Set the actual messages token count from the last API response */
  function setMessagesTokenCount(messagesTokenCount: number) {
    if (messagesTokenCount < lastKnownTokenCount) {
      output.write(
        `Warning: Messages token count decreased from ${lastKnownTokenCount} to ${messagesTokenCount}`,
        OutputColor.error,
      );
    }
    lastKnownTokenCount = messagesTokenCount;
    lastKnownMessageIndex = messages.length;
  }

  function estimateMessagesTokenCount(messages: LlmMessage[]) {
    return messages.reduce((acc, message) => {
      if (typeof message.content === "string") {
        return acc + utilities.getTokenCount(message.content);
      }
      let tokens = 0;
      for (const block of message.content) {
        if (block.type === "text") {
          tokens += utilities.getTokenCount(block.text);
        }
      }
      return acc + tokens;
    }, 0);
  }

  function getTokenCount() {
    if (lastKnownTokenCount > 0) {
      // Use actual count from last API call + estimate only for messages added since
      return (
        lastKnownTokenCount +
        estimateMessagesTokenCount(messages.slice(lastKnownMessageIndex))
      );
    }

    // No API call yet — estimate everything locally
    const systemMessageTokens = utilities.getTokenCount(systemMessage);
    const workspaceTokens = utilities.getTokenCount(getWorkspaceContent());

    return (
      systemMessageTokens +
      workspaceTokens +
      estimateMessagesTokenCount(messages)
    );
  }

  /** Combine message list with adjacent messages of the same role role combined */
  function getCombinedMessages() {
    const combinedMessages: LlmMessage[] = [];
    let lastMessage: LlmMessage | undefined;

    for (const message of messages) {
      // Don't combine if either message has ContentBlock[] content
      const lastIsBlocks =
        lastMessage && typeof lastMessage.content !== "string";
      const currentIsBlocks = typeof message.content !== "string";

      if (
        lastMessage &&
        lastMessage.role == message.role &&
        !lastIsBlocks &&
        !currentIsBlocks
      ) {
        (lastMessage as { content: string }).content += `\n${message.content}`;
      } else {
        const clonedMsg = { ...message };
        combinedMessages.push(clonedMsg);
        lastMessage = clonedMsg;
      }
    }

    // Append workspace content at the end (for prompt cache stability)
    const workspaceContent = getWorkspaceContent();
    if (workspaceContent) {
      if (
        lastMessage &&
        lastMessage.role == LlmRole.User &&
        typeof lastMessage.content === "string"
      ) {
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
    getMessages: () => messages,
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
    appendImage,
    appendAudio,
    clear,
    setMessagesTokenCount,
    getTokenCount,
    getCombinedMessages,
    exportedForTesting,
  };
}

export type ContextManager = ReturnType<typeof createContextManager>;

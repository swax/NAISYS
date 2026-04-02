import { TARGET_MEGAPIXELS } from "@naisys/common";
import { AgentConfig } from "../agent/agentConfig.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { LogService } from "../services/logService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import {
  ContentBlock,
  ContentSource,
  ImageBlock,
  LlmMessage,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "./llmDtos.js";

const IMAGE_TOKENS_PER_MEGAPIXEL = 1000;
const IMAGE_TOKEN_ESTIMATE = IMAGE_TOKENS_PER_MEGAPIXEL * TARGET_MEGAPIXELS;

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
  // Timestamp of the last LLM query (for cache TTL tracking)
  let lastQueryTime = 0;

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
        ? "user"
        : source == ContentSource.LlmPromptResponse ||
            source == ContentSource.LLM
          ? "assistant"
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
    const text = `[Image: ${filepath}]`;

    if (inputMode.isDebug()) {
      output.comment(text);
      return;
    }

    const contentBlocks: ContentBlock[] = [
      { type: "text", text },
      { type: "image", base64, mimeType },
    ];

    const llmMessage: LlmMessage = {
      source: ContentSource.Console,
      role: "user",
      content: contentBlocks,
    };

    messages.push(llmMessage);

    // Log text only — pass filepath for hub attachment upload
    logService.write(llmMessage, filepath);

    // Display placeholder to console
    output.write(text, OutputColor.console);
  }

  function appendAudio(base64: string, mimeType: string, filepath: string) {
    const text = `[Audio: ${filepath}]`;

    if (inputMode.isDebug()) {
      output.comment(text);
      return;
    }

    const contentBlocks: ContentBlock[] = [
      { type: "text", text },
      { type: "audio", base64, mimeType },
    ];

    const llmMessage: LlmMessage = {
      source: ContentSource.Console,
      role: "user",
      content: contentBlocks,
    };

    messages.push(llmMessage);

    // Log text only — pass filepath for hub attachment upload
    logService.write(llmMessage, filepath);

    // Display placeholder to console
    output.write(text, OutputColor.console);
  }

  /** Add an assistant message containing text and tool_use blocks (for computer use).
   *  Always writes to context regardless of input mode — the tool_use/tool_result
   *  protocol requires these for the model to see actions and rejections. */
  function appendDesktopRequest(
    text: string,
    toolUseBlocks: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>,
    actionDesc: string,
  ) {

    const contentBlocks: ContentBlock[] = [];
    if (text) {
      contentBlocks.push({ type: "text", text } satisfies TextBlock);
    }
    for (const block of toolUseBlocks) {
      contentBlocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      } satisfies ToolUseBlock);
    }

    const logMessage = [text, `[Desktop Request: ${actionDesc}]`]
      .filter(Boolean)
      .join("\n");

    const llmMessage: LlmMessage = {
      source: ContentSource.LLM,
      role: "assistant",
      type: "tool",
      content: contentBlocks,
      logMessage,
    };
    messages.push(llmMessage);

    output.write(logMessage, OutputColor.llm);
    logService.write(llmMessage);
  }

  /** Add a user message with a tool_result containing a screenshot image */
  function appendDesktopResult(
    toolUseId: string,
    screenshotBase64: string,
    screenshotMimeType: string,
    filepath?: string,
  ) {

    const resultContent: Array<TextBlock | ImageBlock> = [
      {
        type: "image",
        base64: screenshotBase64,
        mimeType: screenshotMimeType,
      },
    ];

    const logMessage = "[Desktop screenshot]";
    const llmMessage: LlmMessage = {
      source: ContentSource.Console,
      role: "user",
      type: "tool",
      content: [
        {
          type: "tool_result",
          toolUseId,
          resultContent,
        } satisfies ToolResultBlock,
      ],
      logMessage,
    };
    messages.push(llmMessage);

    output.write(logMessage, OutputColor.console);
    logService.write(llmMessage, filepath);
  }

  /** Add a user message with an error tool_result (for rejected desktop actions) */
  function appendDesktopError(
    toolUseId: string,
    errorText: string,
    screenshot?: { base64: string; mimeType: string; filepath?: string },
  ) {
    const resultContent: Array<TextBlock | ImageBlock> = [
      { type: "text", text: errorText },
    ];
    if (screenshot) {
      resultContent.push({
        type: "image",
        base64: screenshot.base64,
        mimeType: screenshot.mimeType,
      });
    }

    const logMessage = `[Desktop Request Cancelled: ${errorText}]`;
    const llmMessage: LlmMessage = {
      source: ContentSource.Console,
      role: "user",
      type: "tool",
      content: [
        {
          type: "tool_result",
          toolUseId,
          // Anthropic API requires all content to be text when is_error is true,
          // so only set the flag when there's no screenshot attached
          isError: !screenshot,
          resultContent,
        } satisfies ToolResultBlock,
      ],
      logMessage,
    };
    messages.push(llmMessage);

    output.write(logMessage, OutputColor.error);
    logService.write(llmMessage, screenshot?.filepath);
  }

  /** Scrub non-text content blocks (image, audio) from recent user messages,
   *  walking backwards until an assistant message is hit.
   *  Removes media blocks and appends "(scrubbed from context)" to the existing text block.
   *  Returns true if anything was scrubbed. */
  function scrubRecentMedia(): boolean {
    let scrubbed = false;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") break;

      if (typeof msg.content === "string") continue;

      const hasMedia = msg.content.some((block) => block.type !== "text");
      if (!hasMedia) continue;

      // Remove media blocks, keep only text
      msg.content = msg.content.filter((block) => block.type === "text");

      // Append scrubbed note to existing text block, or add one
      const textBlock = msg.content.find((block) => block.type === "text");
      if (textBlock) {
        textBlock.text += " (scrubbed from context)";
      } else {
        msg.content.push({ type: "text", text: "(scrubbed from context)" });
      }

      scrubbed = true;
    }

    return scrubbed;
  }

  function clear() {
    messages = [];
    lastKnownTokenCount = 0;
    lastKnownMessageIndex = 0;
    lastQueryTime = 0;
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
    lastQueryTime = Date.now();
  }

  function estimateBlockTokens(block: TextBlock | ImageBlock) {
    return block.type === "image"
      ? IMAGE_TOKEN_ESTIMATE
      : utilities.getTokenCount(block.text);
  }

  function estimateMessagesTokenCount(messages: LlmMessage[]) {
    return messages.reduce((acc, message) => {
      if (typeof message.content === "string") {
        return acc + utilities.getTokenCount(message.content);
      }
      let tokens = 0;
      for (const block of message.content) {
        if (block.type === "text" || block.type === "image") {
          tokens += estimateBlockTokens(block);
        } else if (block.type === "tool_result") {
          for (const inner of block.resultContent) {
            tokens += estimateBlockTokens(inner);
          }
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
        lastMessage.role == "user" &&
        typeof lastMessage.content === "string"
      ) {
        // Combine with the last user message
        lastMessage.content = `${workspaceContent}\n${lastMessage.content}`;
      } else {
        // Add as a new user message
        combinedMessages.push({
          source: ContentSource.Console,
          role: "user",
          content: workspaceContent,
        });
      }
    }

    // Add cache points, role checks are sanity checks
    const beforeWorkspaceMsg = combinedMessages[combinedMessages.length - 2];
    if (
      agentConfig().workspacesEnabled &&
      beforeWorkspaceMsg &&
      beforeWorkspaceMsg.role === "assistant"
    ) {
      beforeWorkspaceMsg.cachePoint = true;
    }

    const latestPromptMsg = combinedMessages[combinedMessages.length - 1];
    if (latestPromptMsg && latestPromptMsg.role === "user") {
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
    appendDesktopRequest,
    appendDesktopResult,
    appendDesktopError,
    scrubRecentMedia,
    clear,
    setMessagesTokenCount,
    getLastQueryTime: () => lastQueryTime,
    getTokenCount,
    getCombinedMessages,
    exportedForTesting,
  };
}

export type ContextManager = ReturnType<typeof createContextManager>;

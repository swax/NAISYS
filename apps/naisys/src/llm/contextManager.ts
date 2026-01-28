import { WorkspacesFeature } from "../features/workspaces.js";
import { GlobalConfig } from "../globalConfig.js";
import { LogService } from "../services/logService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { ContentSource, LlmMessage, LlmRole } from "./llmDtos.js";

export function createContextManager(
  { globalConfig }: GlobalConfig,
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
    llmMessage.logId = await logService.write(llmMessage);
  }

  function clear() {
    _messages = [];

    if (!globalConfig().workspacesEnabled) {
      return;
    }

    // Append workspace
    _messages.push({
      source: ContentSource.Console,
      role: LlmRole.User,
      content: "",
      type: "workspace",
    });
  }

  function getTokenCount() {
    const sytemMessageTokens = utilities.getTokenCount(systemMessage);

    updateWorkspaces();

    return _messages.reduce((acc, message) => {
      return acc + utilities.getTokenCount(message.content);
    }, sytemMessageTokens);
  }

  function printContext() {
    let content = `------ System ------`;
    content += `\n${systemMessage}`;

    getCombinedMessages().forEach((message) => {
      content += `\n\n------ ${logService.toSimpleRole(message.role)} ------`;
      content += `\n${message.content}`;
    });

    return content;
  }

  /** Combine message list with adjacent messages of the same role role combined */
  function getCombinedMessages() {
    updateWorkspaces();

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

    return combinedMessages;
  }

  const exportedForTesting = {
    getMessages: () => _messages,
  };

  function updateWorkspaces() {
    if (!globalConfig().workspacesEnabled) {
      return;
    }

    // Find the workspaces type message
    const workspaceMessage = _messages.find((m) => m.type == "workspace");
    if (!workspaceMessage) {
      throw "Workspace message not found in context";
    }

    workspaceMessage.content = workspaces.getLatestContent();
  }

  return {
    append,
    clear,
    getTokenCount,
    printContext,
    getCombinedMessages,
    exportedForTesting,
  };
}

export type ContextManager = ReturnType<typeof createContextManager>;

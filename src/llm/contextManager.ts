import { createConfig } from "../config.js";
import { createWorkspacesFeature } from "../features/workspaces.js";
import { createLogService } from "../services/logService.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import { createOutputService, OutputColor } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { ContentSource, LlmMessage, LlmRole } from "./llmDtos.js";

export function createContextManager(
  config: Awaited<ReturnType<typeof createConfig>>,
  workspaces: ReturnType<typeof createWorkspacesFeature>,
  systemMessage: string,
  output: ReturnType<typeof createOutputService>,
  logService: ReturnType<typeof createLogService>,
) {
  let _messages: LlmMessage[] = [];

  clear();

  async function append(
    content: string,
    source: ContentSource = ContentSource.Console,
    promptIndex?: number,
  ) {
    if (!content) {
      return;
    }

    if (
      promptIndex &&
      (source != ContentSource.ConsolePrompt ||
        inputMode.current === InputMode.Debug)
    ) {
      throw new Error(
        "Prompt index can only be set for console prompts in LLM input mode",
      );
    }

    // Debug runs in a shadow mode where their activity is not recorded in the context
    // Mark with a # to make it clear that it is not part of the context
    if (inputMode.current === InputMode.Debug) {
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

    const llmMessage = <LlmMessage>{ source, role, content, promptIndex };
    _messages.push(llmMessage);

    // Log the message
    llmMessage.logId = await logService.write(llmMessage);
    logService.recordContext(printContext());
  }

  function clear() {
    _messages = [];

    if (!config.workspacesEnabled) {
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

  function trim(
    /** Example: 1-5, 8, 11-13 */
    args: string,
  ): string {
    args = utilities.trimChars(args, " \"'");

    const indexGroups = args.split(",");

    let tokensReduced = 0;

    for (const indexGroup of indexGroups) {
      const indexRange = indexGroup.split("-");

      let trimStart = 0;
      let trimEnd = 0;

      if (indexRange.length == 1) {
        trimStart = trimEnd = parseInt(indexRange[0]);
      } else if (indexRange.length == 2) {
        trimStart = parseInt(indexRange[0]);
        trimEnd = parseInt(indexRange[1]);
      } else {
        throw "Invalid index range: " + indexGroup;
      }

      if (trimEnd < trimStart) {
        throw "End index must be greater than start index";
      }

      const trimmedMessages = [];
      let trimming = false;

      for (let i = 0; i < _messages.length; i++) {
        const m = _messages[i];

        // Trim until the next console prompt is hit
        if (m.source == ContentSource.ConsolePrompt && trimming) {
          trimming = false;
        }

        if (
          trimming ||
          (m.promptIndex &&
            m.promptIndex >= trimStart &&
            m.promptIndex <= trimEnd)
        ) {
          output.comment(`Trimmed: ${m.content}`);
          tokensReduced += utilities.getTokenCount(m.content);
          trimming = true;
        } else {
          trimmedMessages.push(m);
        }
      }

      _messages = trimmedMessages;
    }

    return `Trimmed session by ${tokensReduced} tokens`;
  }

  const exportedForTesting = {
    getMessages: () => _messages,
  };

  function updateWorkspaces() {
    if (!config.workspacesEnabled) {
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
    trim,
    exportedForTesting,
  };
}

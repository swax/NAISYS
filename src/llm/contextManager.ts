import * as workspaces from "../apps/workspaces.js";
import * as config from "../config.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as logService from "../utils/logService.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { ContentSource, LlmMessage, LlmRole } from "./llmDtos.js";

let _cachedSystemMessage = "";

let _messages: LlmMessage[] = [];

clear();

export function getSystemMessage() {
  if (_cachedSystemMessage) {
    return _cachedSystemMessage;
  }

  let genImgCmd = "";
  if (config.agent.imageModel) {
    genImgCmd = `\n  genimg "<description>" <filepath>: Generate an image with the description and save it to the given fully qualified path`;
  }

  let llmailCmd = "";
  if (config.mailEnabled) {
    llmailCmd = `\n  llmail: A local mail system for communicating with your team`;
  }

  let workspaces = "";
  if (config.workspacesEnabled) {
    workspaces = `\nWorkspaces:`;
    workspaces += `\n  Put file soft links into ~/workspace/ to see their latest contents live updated here.`;
  }

  let endsession = "";
  if (config.endSessionEnabled) {
    endsession = `\n  endsession "<note>": Ends this session, clears the console log and context.
    The note should help you find your bearings in the next session. 
    The note should contain your next goal, and important things should you remember.`;
  }

  let trimSession = "";
  if (config.trimSessionEnabled) {
    trimSession = `\n  trimsession <indexes>: Saves tokesn by removing the specified prompts and respective output with matching <indexes>. For example '1-5, 8, 11-13'`;
  }

  let tokenNote = "";

  if (config.endSessionEnabled) {
    tokenNote =
      "\n  Make sure to call 'endsession' before the limit is hit so you can continue your work with a fresh console";
  }

  if (!config.endSessionEnabled && config.trimSessionEnabled) {
    tokenNote =
      "\n  Make sure to call 'trimsession' before the limit is hit so you stay under the limit.\n  Use comments to remember important things from trimmed prompts.";
  }

  // Fill out the templates in the agent prompt and stick it to the front of the system message
  // A lot of the stipulations in here are to prevent common LLM mistakes
  // Like we can't jump between standard and special commands in a single prompt, which the LLM will try to do if not warned
  let agentPrompt = config.agent.agentPrompt;
  agentPrompt = config.resolveConfigVars(agentPrompt);

  const systemMessage = `${agentPrompt.trim()}

This is a command line interface presenting you with the next command prompt. 
Make sure the read the command line rules in the MOTD carefully.
Don't try to guess the output of commands. Don't put commands in \`\`\` blocks.
For example when you run 'cat' or 'ls', don't write what you think the output will be. Let the system do that.
Your role is that of the user. The system will provide responses and next command prompt. Don't output your own command prompt.
Be careful when writing files through the command prompt with cat. Make sure to close and escape quotes properly.
Don't blindly overwrite existing files without reading them first.

NAISYS ${config.packageVersion} Shell
Welcome back ${config.agent.username}!
MOTD:
Date: ${new Date().toLocaleString()}
LINUX Commands: 
  Standard Linux commands are available
  vi and nano are not supported
  Read files with cat. Write files with \`cat > filename << 'EOF'\`
  Do not input notes after the prompt. Only valid commands.
NAISYS Commands: (cannot be used with other commands on the same prompt)${llmailCmd}
  llmynx: A context optimized web browser. Enter 'llmynx help' to learn how to use it${genImgCmd}
  comment "<thought>": Any non-command output like thinking out loud, prefix with the 'comment' command
  pause <seconds>: Pause for <seconds>${trimSession}${endsession}
Tokens:
  The console log can only hold a certain number of 'tokens' that is specified in the prompt${tokenNote}${workspaces}`;

  _cachedSystemMessage = systemMessage;
  return systemMessage;
}

export async function append(
  content: string,
  source: ContentSource = ContentSource.Console,
  promptIndex?: number,
) {
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
      : source == ContentSource.LlmPromptResponse || source == ContentSource.LLM
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

export function clear() {
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

export function getTokenCount() {
  const sytemMessageTokens = utilities.getTokenCount(getSystemMessage());

  updateWorkspaces();

  return _messages.reduce((acc, message) => {
    return acc + utilities.getTokenCount(message.content);
  }, sytemMessageTokens);
}

export function printContext() {
  let content = `------ System ------`;
  content += `\n${getSystemMessage()}`;

  getCombinedMessages().forEach((message) => {
    content += `\n\n------ ${logService.roleToSource(message.role)} ------`;
    content += `\n${message.content}`;
  });

  return content;
}

/** Combine message list with adjacent messages of the same role role combined */
export function getCombinedMessages() {
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

export function trim(
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

export const exportedForTesting = {
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

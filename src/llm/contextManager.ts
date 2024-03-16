import * as config from "../config.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as logService from "../utils/logService.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { LlmMessage, LlmRole } from "./llmDtos.js";

export enum ContentSource {
  ConsolePrompt = "startPrompt",
  LlmPromptResponse = "endPrompt",
  Console = "console",
  LLM = "llm",
}

let _cachedSystemMessage = "";

export function getSystemMessage() {
  if (_cachedSystemMessage) {
    return _cachedSystemMessage;
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

NAISYS ${config.packageVersion} Shell
Welcome back ${config.agent.username}!
MOTD:
Date: ${new Date().toLocaleString()}
LINUX Commands: 
  Standard Linux commands are available
  vi and nano are not supported
  Read files with cat. Write files with \`cat > filename << 'EOF'\`
  Do not input notes after the prompt. Only valid commands.
NAISYS Commands: (cannot be used with other commands on the same prompt)
  llmail: A local mail system for communicating with your team
  llmynx: A context optimized web browser. Enter 'llmynx help' to learn how to use it
  comment "<thought>": Any non-command output like thinking out loud, prefix with the 'comment' command
  pause <seconds>: Pause for <seconds>
  endsession "<note>": Ends this session, clears the console log and context.
    The note should help you find your bearings in the next session. 
    The note should contain your next goal, and important things should you remember.
Tokens:
  The console log can only hold a certain number of 'tokens' that is specified in the prompt
  Make sure to call endsession before the limit is hit so you can continue your work with a fresh console`;

  _cachedSystemMessage = systemMessage;
  return systemMessage;
}

export let messages: LlmMessage[] = [];

export async function append(
  text: string,
  source: ContentSource = ContentSource.Console,
) {
  // Debug runs in a shadow mode where their activity is not recorded in the context
  // Mark with a # to make it clear that it is not part of the context
  if (inputMode.current === InputMode.Debug) {
    output.comment(text);
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

  // If last message is the same role then combine - Googl API requires alterntating roles
  // TODO: Maybe dont do this here, but in the google api call
  let combined = false;

  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];

    if (lastMessage.role == role) {
      lastMessage.content += `\n${text}`;
      combined = true;
      await logService.update(lastMessage, text);
    }
  }

  if (!combined) {
    const llmMessage = <LlmMessage>{ role, content: text };
    llmMessage.logId = await logService.write(llmMessage);
    messages.push(llmMessage);
  }

  // Prompts are manually added to the console log
  if (
    source != ContentSource.ConsolePrompt &&
    source != ContentSource.LlmPromptResponse
  ) {
    output.write(text, source == "llm" ? OutputColor.llm : OutputColor.console);
  }
}

export function clear() {
  messages = [];
}

export function getTokenCount() {
  const sytemMessageTokens = utilities.getTokenCount(getSystemMessage());

  return messages.reduce((acc, message) => {
    return acc + utilities.getTokenCount(message.content);
  }, sytemMessageTokens);
}

export function printContext() {
  output.comment("#####################");
  // output.comment(content);
  messages.forEach((message) => {
    output.comment(`${message.role}: ${message.content}`);
  });
  output.comment("#####################");
}

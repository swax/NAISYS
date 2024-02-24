import * as config from "./config.js";
import * as contextLog from "./contextLog.js";
import { LlmMessage, LlmRole } from "./contextLog.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as output from "./output.js";
import { OutputColor } from "./output.js";
import * as utilities from "./utilities.js";
import { valueFromString } from "./utilities.js";

export enum ContentSource {
  StartPrompt = "startPrompt",
  EndPrompt = "endPrompt",
  Console = "console",
  LLM = "llm",
}

let _cachedSystemMessage = "";

export function getSystemMessage() {
  if (_cachedSystemMessage) {
    return _cachedSystemMessage;
  }

  const agentPrompt = config.agent.agentPrompt.replace(
    /\$\{config\.([^\}]+)\}/g,
    (match, key) => {
      const value = valueFromString(config, key);
      if (value === undefined) {
        throw `Agent config: Error, ${key} is not defined`;
      }
      return value;
    },
  );

  const systemMessage = `${agentPrompt}

This is a command line interface presenting you with the next command prompt. 
Make sure the read the command line rules in the MOTD carefully.
Don't try to guess the output of commands. 
For example when you run 'cat' or 'ls', don't write what you think the output will be. Let the system do that.
Your role is that of the user. The system will provide responses and next command prompt. Don't output your own command prompt.
Be careful when writing files through the command prompt with cat. Make sure to close and escape quotes properly.

NAISYS 1.0 Shell
Welcome back ${config.agent.username}!
MOTD:
Date: ${new Date().toUTCString()}
Commands: 
  Standard Unix commands are available
  vi and nano are not supported
  Read/write entire files in a single command with cat
  Do not input notes after the prompt. Only valid commands.
Special Commands:
  comment <thought>: Any non-command output like thinking out loud, prefix with the 'comment' command
  pause <seconds>: Pause for <seconds> or indeterminite if no argument is provided. Auto wake up on new mail message
  endsession <note>: Ends this session, clears the console log. Add notes to carry over to the next session
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
  // Root runs in a shadow mode where their activity is not recorded in the context
  // Mark with a # to make it clear that it is not part of the context
  if (inputMode.current === InputMode.Debug) {
    output.comment(text);
    return;
  }

  // Else otherwise we're running in LLM mode
  const role =
    source == ContentSource.StartPrompt || source == ContentSource.Console
      ? LlmRole.User
      : source == ContentSource.EndPrompt || source == ContentSource.LLM
        ? LlmRole.Assistant
        : undefined;

  if (!role) {
    throw new Error("Invalid source");
  }

  // If last message is the same role then combine - Googl API requires alterntating roles
  let combined = false;

  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];

    if (lastMessage.role == role) {
      lastMessage.content += `\n${text}`;
      combined = true;
      await contextLog.update(lastMessage, text);
    }
  }

  if (!combined) {
    const llmMessage = { role, content: text };
    await contextLog.add(llmMessage);
    messages.push(llmMessage);
  }

  // Prompts are manually added to the console log
  if (source != "startPrompt" && source != "endPrompt") {
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

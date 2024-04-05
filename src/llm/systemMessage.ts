/**
 * Generates the system message for prefixing the context sent to the LLM
 *
 * Broken into three parts:
 * 1. The agent prompt from the agent config
 * 2. A summary of situation, 'you are a psuedo-user in a command shell'
 * 3. The MTOD for the shell itself as if the agent just logged in
 *
 * We start with lots of conditional logic to build up the system message.
 * Once exported the system message is essentially cached
 */

import * as config from "../config.js";

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

let subagentNote = "";
if ((config.agent.subagentMax || 0) > 0) {
  subagentNote += `\n  subagent: You can create subagents to help you with your work. You can have up to ${config.agent.subagentMax} subagents.`;
}

// Fill out the templates in the agent prompt and stick it to the front of the system message
// A lot of the stipulations in here are to prevent common LLM mistakes
// Like we can't jump between standard and special commands in a single prompt, which the LLM will try to do if not warned
let agentPrompt = config.agent.agentPrompt;
agentPrompt = config.resolveConfigVars(agentPrompt);

// Build up the final system message
export const systemMessage = `${agentPrompt.trim()}

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
NAISYS Commands: (cannot be used with other commands on the same prompt)${llmailCmd}${subagentNote}
  llmynx: A context optimized web browser. Enter 'llmynx help' to learn how to use it${genImgCmd}
  comment "<thought>": Any non-command output like thinking out loud, prefix with the 'comment' command
  pause <seconds>: Pause for <seconds>${trimSession}${endsession}
Tokens:
  The console log can only hold a certain number of 'tokens' that is specified in the prompt${tokenNote}${workspaces}`;

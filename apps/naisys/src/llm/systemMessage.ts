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

import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { getPlatformConfig } from "../services/shellPlatform.js";

export function createSystemMessage(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
) {
  const platformConfig = getPlatformConfig();

  let genImgCmd = "";
  if (agentConfig().imageModel) {
    genImgCmd = `\n  ns-genimg "<description>" <filepath>: Generate an image with the description and save it to the given fully qualified path`;
  }

  let llmailCmd = "";
  if (agentConfig().mailEnabled) {
    llmailCmd = `\n  ns-mail: A local mail system for communicating with your team`;
  }

  let lynxCmd = "";
  if (agentConfig().webEnabled) {
    lynxCmd = `\n  ns-lynx: A context optimized web browser. Enter 'ns-lynx help' to learn how to use it`;
  }

  let workspaceCmd = "";
  if (agentConfig().workspacesEnabled) {
    workspaceCmd = `\n  ns-workspace: Use to pin files to the session so the you always sees the latest file contents`;
  }

  // Build ns-session command help based on enabled features
  let sessionCmd = "";
  const sessionSubcommands: string[] = [];

  sessionSubcommands.push(`pause <seconds> - Pause for <seconds>`);
  if (globalConfig().compactSessionEnabled) {
    sessionSubcommands.push(
      `compact "<note>" - Compact the session which will reset the token count. The note should contain your next goal, and important things you should remember.`,
    );
  }
  if (agentConfig().completeTaskEnabled) {
    sessionSubcommands.push(
      `complete "<result>" - Mark task complete and exit. The result should contain any important information or output from the task.`,
    );
  }

  if (sessionSubcommands.length > 0) {
    sessionCmd = `\n  ns-session: Session management. Subcommands:
    ${sessionSubcommands.join("\n    ")}`;
  }

  let tokenNote = "";

  if (globalConfig().compactSessionEnabled) {
    tokenNote =
      "\n  Make sure to call 'ns-session compact' before the token limit is hit so you can continue your work without interruption.";
  }

  if (agentConfig().disableMultipleCommands) {
    tokenNote +=
      "\n  Only run one command at a time, evaluate the output, then run the next command. Don't overload the same line with multiple commands either.";
  } else {
    tokenNote +=
      "\n  Be careful running multiple commands on a single prompt, and never assume the output of commands. Better to run one command at a time if you're not sure.";
  }

  const subagentNote = `\n  ns-agent: You can create subagents to help you with your work.`;

  // Fill out the templates in the agent prompt and stick it to the front of the system message
  // A lot of the stipulations in here are to prevent common LLM mistakes
  // Like we can't jump between standard and special commands in a single prompt, which the LLM will try to do if not warned
  let agentPrompt = agentConfig().agentPrompt;
  agentPrompt = agentConfig().resolveConfigVars(agentPrompt);

  // Build up the final system message
  const systemMessage = `${agentPrompt.trim()}

This is a command line interface presenting you with the next command prompt.
*** Your response will literally be piped into a command shell, so you must use valid commands.
Make sure the read the command line rules in the MOTD carefully.
Don't put commands in \`\`\` blocks.
Do not preempt or hallucinate the output of commands. The system will provide the output of commands you.
For example when you run 'cat' or 'ls', don't write what you think the output will be. Let the system do that.
The system will provide responses and next command prompt. Don't output your own command prompt.
Be careful when writing files through the command prompt with cat. Make sure to close and escape quotes properly.
Don't blindly overwrite existing files without reading them first.

NAISYS ${globalConfig().packageVersion} Shell
Welcome back ${agentConfig().username}!
MOTD:
Date: ${new Date().toLocaleString()}
${platformConfig.displayName} Commands:
  Standard ${platformConfig.shellName} commands are available${
    platformConfig.platform === "windows"
      ? `
  PowerShell has aliases for common commands: ls, cat, pwd, cd, mkdir, rm, cp, mv
  Read files with Get-Content. Write files with Set-Content -Path "file" -Value "content"`
      : `
  vi and nano are not supported
  Read files with cat. Write files with \`cat > filename << 'EOF'\``
  }
  Do not input notes after the prompt. Only valid commands.
NAISYS Commands: (cannot be used with other commands on the same prompt)${llmailCmd}${subagentNote}${lynxCmd}${genImgCmd}${workspaceCmd}
  ns-comment "<thought>": Any non-command output like thinking out loud, prefix with the 'ns-comment' command${sessionCmd}
Tokens:
  The console log can only hold a certain number of 'tokens' that is specified in the prompt${tokenNote}`;

  return systemMessage;
}

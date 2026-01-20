import chalk from "chalk";
import * as readline from "readline";
import { AgentConfig } from "../agent/agentConfig.js";
import { LLMail } from "../features/llmail.js";
import { LLMynx } from "../features/llmynx.js";
import { SubagentService } from "../features/subagent.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { ContentSource, LlmRole } from "../llm/llmDtos.js";
import { LlmApiType } from "../llm/llModels.js";
import { LLMService } from "../llm/llmService.js";
import { SessionCompactor } from "../llm/sessionCompactor.js";
import { LogService } from "../services/logService.js";
import { RunService } from "../services/runService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { CommandHandler } from "./commandHandler.js";
import { NextCommandAction } from "./commandRegistry.js";
import { PromptBuilder } from "./promptBuilder.js";
import { ShellCommand } from "./shellCommand.js";

export function createCommandLoop(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  commandHandler: CommandHandler,
  promptBuilder: PromptBuilder,
  shellCommand: ShellCommand,
  subagent: SubagentService,
  llmail: LLMail,
  llmynx: LLMynx,
  sessionCompactor: SessionCompactor,
  contextManager: ContextManager,
  workspaces: WorkspacesFeature,
  llmService: LLMService,
  systemMessage: string,
  output: OutputService,
  logService: LogService,
  inputMode: InputModeService,
  runService: RunService,
) {
  async function run(abortSignal?: AbortSignal) {
    await output.commentAndLog(`AGENT STARTED`);

    // Show Agent Config exept the agent prompt
    await output.commentAndLog(
      `Agent configured to use ${agentConfig().shellModel} model`,
    );

    // Show System Message
    await output.commentAndLog("System Message:");
    output.write(systemMessage);
    await logService.write({
      role: LlmRole.System,
      content: systemMessage,
      type: "system",
    });

    let nextCommandAction = NextCommandAction.Continue;

    let llmErrorCount = 0;
    let nextPromptIndex = 0;

    while (
      nextCommandAction != NextCommandAction.ExitApplication &&
      !abortSignal?.aborted
    ) {
      inputMode.setLLM();

      await output.commentAndLog("Starting Context:");

      const lastSessionSummary = await sessionCompactor.getLastSessionSummary();
      if (lastSessionSummary) {
        await displayPreviousSessionNotes(
          lastSessionSummary,
          nextPromptIndex++,
        );
      }

      for (const initialCommand of agentConfig().initialCommands) {
        let prompt = await promptBuilder.getPrompt(0, false);
        prompt = setPromptIndex(prompt, ++nextPromptIndex);
        await contextManager.append(
          prompt,
          ContentSource.ConsolePrompt,
          nextPromptIndex,
        );
        await commandHandler.processCommand(prompt, [
          agentConfig().resolveConfigVars(initialCommand),
        ]);
      }

      inputMode.setDebug();

      let pauseSeconds = agentConfig().debugPauseSeconds;
      let wakeOnMessage = agentConfig().wakeOnMessage;

      while (
        nextCommandAction == NextCommandAction.Continue &&
        !abortSignal?.aborted
      ) {
        if (shellCommand.isShellSuspended()) {
          const elapsedTime = shellCommand.getCommandElapsedTimeString();
          await contextManager.append(
            `Command has been running for ${elapsedTime}. Enter 'wait <seconds>' to continue waiting. 'kill' to terminate. Other input will be sent to the process.`,
            ContentSource.Console,
          );
        }

        if (agentConfig().shellModel === LlmApiType.None) {
          pauseSeconds = 0;
          wakeOnMessage = true;
        }

        let prompt = await promptBuilder.getPrompt(pauseSeconds, wakeOnMessage);
        let commandList: string[] = [];
        let blankDebugInput = false;

        // Debug command prompt
        if (inputMode.isDebug()) {
          commandList = [
            await promptBuilder.getInput(
              `${prompt}`,
              pauseSeconds,
              wakeOnMessage,
            ),
          ];

          blankDebugInput = commandList[0].trim().length == 0;
        }
        // LLM command prompt
        else if (inputMode.isLLM()) {
          prompt = setPromptIndex(prompt, ++nextPromptIndex);

          const workingMsg =
            prompt +
            chalk[OutputColor.loading](
              `LLM (${agentConfig().shellModel}) Working...`,
            );

          try {
            // In the cases that the input prompt is interrupted for a notification, return to the debug prompt
            if (
              subagent.switchEventTriggered("clear") ||
              (await checkNewMailNotification()) ||
              (await checkSubagentsTerminated()) ||
              agentConfig().shellModel === LlmApiType.None // Check this last so notications get processed/cleared
            ) {
              inputMode.setDebug();
              continue;
            }

            await checkContextLimitWarning();

            await workspaces.displayActive();

            await contextManager.append(
              prompt,
              ContentSource.ConsolePrompt,
              nextPromptIndex,
            );

            if (output.isConsoleEnabled()) {
              process.stdout.write(workingMsg);
            }

            commandList = await llmService.query(
              agentConfig().shellModel,
              systemMessage,
              contextManager.getCombinedMessages(),
              "console",
            );

            clearPromptMessage(workingMsg);
          } catch (e) {
            // Can't do this in a finally because it needs to happen before the error is printed
            clearPromptMessage(workingMsg);

            ({ llmErrorCount, pauseSeconds, wakeOnMessage } =
              await handleErrorAndSwitchToDebugMode(e, llmErrorCount, false));

            continue;
          }
        } else {
          throw `Unreachable: Invalid input mode`;
        }

        // Run the command
        try {
          ({ nextCommandAction, pauseSeconds, wakeOnMessage } =
            await commandHandler.processCommand(prompt, commandList));

          if (inputMode.isLLM()) {
            llmErrorCount = 0;
          }
        } catch (e) {
          ({ llmErrorCount, pauseSeconds, wakeOnMessage } =
            await handleErrorAndSwitchToDebugMode(e, llmErrorCount, true));
          continue;
        }

        // If the user is in debug mode and they didn't enter anything, switch to LLM
        // If in LLM mode, auto switch back to debug
        if ((inputMode.isDebug() && blankDebugInput) || inputMode.isLLM()) {
          inputMode.toggle();
        }
      }

      if (nextCommandAction == NextCommandAction.CompactSession) {
        llmynx.clear();
        contextManager.clear();
        await runService.incrementSession();
        nextCommandAction = NextCommandAction.Continue;
        nextPromptIndex = 0;
      }
    }

    if (abortSignal?.aborted) {
      await output.commentAndLog(`AGENT STOPPED (${abortSignal.reason})`);
    } else {
      await output.commentAndLog(`AGENT EXITED`);
    }
  }

  function clearPromptMessage(waitingMessage: string) {
    if (output.isConsoleEnabled()) {
      readline.moveCursor(process.stdout, -waitingMessage.length, 0);
      process.stdout.write(" ".repeat(waitingMessage.length));
      readline.moveCursor(process.stdout, -waitingMessage.length, 0);
    }
  }

  /** Name is comically long because of a prettier formatting issue when the name is too short */
  async function handleErrorAndSwitchToDebugMode(
    e: unknown,
    llmErrorCount: number,
    addToContext: boolean,
  ) {
    const maxErrorLength = 200;
    const errorMsg = `${e}`;

    if (addToContext) {
      await contextManager.append(errorMsg.slice(0, maxErrorLength));

      if (errorMsg.length > maxErrorLength) {
        await contextManager.append("...");
        await output.errorAndLog(
          `Error too long for context: ${errorMsg.slice(200)}`,
        );
      }
    } else {
      await output.errorAndLog(errorMsg);
    }

    // If llm is in some error loop then hold in debug mode
    let pauseSeconds = agentConfig().debugPauseSeconds;
    let wakeOnMessage = agentConfig().wakeOnMessage;

    if (inputMode.isLLM()) {
      llmErrorCount++;

      // Set the pause seconds to exponential backoff, up to retrySecondsMax
      pauseSeconds = agentConfig().debugPauseSeconds * 2 ** (llmErrorCount - 1);

      if (pauseSeconds > globalConfig().retrySecondsMax) {
        pauseSeconds = globalConfig().retrySecondsMax;
        llmErrorCount--; // Prevent overflowing the calculation above
      }
    }

    inputMode.setDebug();

    return {
      llmErrorCount,
      pauseSeconds,
      wakeOnMessage,
    };
  }

  async function checkSubagentsTerminated() {
    if (!agentConfig().subagentMax) {
      return false;
    }

    const terminationEvents = subagent.getTerminationEvents("clear");
    for (const event of terminationEvents) {
      await contextManager.append(
        `Subagent ${event.id} ${event.agentName} has terminated. Reason: ${event.reason}`,
        ContentSource.Console,
      );
    }
    return terminationEvents.length > 0;
  }

  let mailBlackoutCountdown = 0;

  /**
   * Return true if new mail was found and marked as shown, as that will let the user evaluate the prompt again.
   * Returning true otherwise will prevent the LLM from running
   */
  async function checkNewMailNotification() {
    if (!agentConfig().mailEnabled) {
      return false;
    }

    let supressMail = false;
    if (mailBlackoutCountdown > 0) {
      mailBlackoutCountdown--;
      supressMail = true;
    }

    // Check for unread messages
    const unreadMessages = await llmail.getUnreadThreads();
    if (!unreadMessages.length) {
      return false;
    }

    if (supressMail) {
      await output.commentAndLog(
        `New mail notifications blackout in effect. ${mailBlackoutCountdown} cycles remaining.`,
      );
      return false;
    }

    // Get the new messages
    const newMessageContents: string[] = [];
    for (const { message_id } of unreadMessages) {
      // readMessage marks as read, so we read them all
      newMessageContents.push(await llmail.readMessage(message_id));
    }

    // Check that token max for session will not be exceeded
    const newMsgTokenCount = newMessageContents.reduce(
      (acc, msg) => acc + utilities.getTokenCount(msg),
      0,
    );

    const sessionTokens = contextManager.getTokenCount();
    const tokenMax = agentConfig().tokenMax;

    // Show full messages unless we are close to the token limit of the session
    if (sessionTokens + newMsgTokenCount < tokenMax * 0.75) {
      for (const newMessage of newMessageContents) {
        await contextManager.append("New Message:", ContentSource.Console);
        await contextManager.append(newMessage, ContentSource.Console);
      }

      mailBlackoutCountdown = agentConfig().mailBlackoutCycles || 0;

      return true;
    } else {
      await contextManager.append(
        `You have new mail, but not enough context to read them.\n` +
          `After you run 'ns-session compact' you will be able to read them.`,
        ContentSource.Console,
      );
    }

    return false;
  }

  async function checkContextLimitWarning() {
    const tokenCount = contextManager.getTokenCount();
    const tokenMax = agentConfig().tokenMax;

    if (tokenCount > tokenMax) {
      let tokenNote = "";

      if (globalConfig().compactSessionEnabled) {
        tokenNote += `\nUse 'ns-session compact "<note>"' to clear the console and reset the session.
    The note should help you find your bearings in the next session.
    The note should contain your next goal, and important things should you remember.`;
      }

      if (globalConfig().trimSessionEnabled) {
        tokenNote += `\nUse 'ns-session trim' to reduce the size of the session.
    Use comments to remember important things from trimmed prompts.`;
      }

      await contextManager.append(
        `The token limit for this session has been exceeded.${tokenNote}`,
        ContentSource.Console,
      );
    }
  }

  /** Insert prompt index [Index: 1] before the $.
   * Insert at the end of the prompt so that 'prompt splitting' still works in the command handler
   */
  function setPromptIndex(prompt: string, index: number) {
    if (!globalConfig().trimSessionEnabled) {
      return prompt;
    }

    let newPrompt = prompt;

    const endPromptPos = prompt.lastIndexOf("$");
    if (endPromptPos != -1) {
      newPrompt =
        prompt.slice(0, endPromptPos) +
        ` [Index: ${index}]` +
        prompt.slice(endPromptPos);
    }

    return newPrompt;
  }

  async function displayPreviousSessionNotes(
    prevSessionNotes: string,
    nextPromptIndex: number,
  ) {
    let prompt = await promptBuilder.getPrompt(0, false);
    prompt = setPromptIndex(prompt, ++nextPromptIndex);
    await contextManager.append(
      prompt,
      ContentSource.ConsolePrompt,
      nextPromptIndex,
    );
    const prevSessionNotesCommand = "cat ~/prev_session_notes";
    await contextManager.append(
      prevSessionNotesCommand,
      ContentSource.LlmPromptResponse,
    );
    output.write(prompt + chalk[OutputColor.llm](prevSessionNotesCommand));
    await contextManager.append(prevSessionNotes);
  }

  return {
    run,
  };
}

export type CommandLoop = ReturnType<typeof createCommandLoop>;

import chalk from "chalk";
import * as readline from "readline";
import { createConfig } from "../config.js";
import { createLLMail } from "../features/llmail.js";
import { createLLMynx } from "../features/llmynx.js";
import { createSubagentService } from "../features/subagent.js";
import { createWorkspacesFeature } from "../features/workspaces.js";
import { createContextManager } from "../llm/contextManager.js";
import { createDreamMaker } from "../llm/dreamMaker.js";
import { ContentSource, LlmRole } from "../llm/llmDtos.js";
import { LlmApiType } from "../llm/llModels.js";
import { createLLMService } from "../llm/llmService.js";
import { createLogService } from "../services/logService.js";
import { createInputMode } from "../utils/inputMode.js";
import { createOutputService, OutputColor } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { createCommandHandler, NextCommandAction } from "./commandHandler.js";
import { createPromptBuilder } from "./promptBuilder.js";
import { createShellCommand } from "./shellCommand.js";

export function createCommandLoop(
  config: Awaited<ReturnType<typeof createConfig>>,
  commandHandler: ReturnType<typeof createCommandHandler>,
  promptBuilder: ReturnType<typeof createPromptBuilder>,
  shellCommand: ReturnType<typeof createShellCommand>,
  subagent: ReturnType<typeof createSubagentService>,
  llmail: ReturnType<typeof createLLMail>,
  llmynx: ReturnType<typeof createLLMynx>,
  dreamMaker: ReturnType<typeof createDreamMaker>,
  contextManager: ReturnType<typeof createContextManager>,
  workspaces: ReturnType<typeof createWorkspacesFeature>,
  llmService: ReturnType<typeof createLLMService>,
  systemMessage: string,
  output: ReturnType<typeof createOutputService>,
  logService: ReturnType<typeof createLogService>,
  inputMode: ReturnType<typeof createInputMode>,
) {
  async function run(abortSignal?: AbortSignal) {
    await output.commentAndLog(`AGENT STARTED`);

    // Show Agent Config exept the agent prompt
    await output.commentAndLog(
      `Agent configured to use ${config.agent.shellModel} model`,
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

      const latestDream = await dreamMaker.goodmorning();
      if (latestDream) {
        await displayPreviousSessionNotes(latestDream, nextPromptIndex++);
      }

      for (const initialCommand of config.agent.initialCommands) {
        let prompt = await promptBuilder.getPrompt(0, false);
        prompt = setPromptIndex(prompt, ++nextPromptIndex);
        await contextManager.append(
          prompt,
          ContentSource.ConsolePrompt,
          nextPromptIndex,
        );
        await commandHandler.processCommand(prompt, [
          config.resolveConfigVars(initialCommand),
        ]);
      }

      inputMode.setDebug();

      let pauseSeconds = config.agent.debugPauseSeconds;
      let wakeOnMessage = config.agent.wakeOnMessage;

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

        if (config.agent.shellModel === LlmApiType.None) {
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
              `LLM (${config.agent.shellModel}) Working...`,
            );

          try {
            // In the cases that the input prompt is interrupted for a notification, return to the debug prompt
            if (
              subagent.switchEventTriggered("clear") ||
              (await checkNewMailNotification()) ||
              (await checkSubagentsTerminated()) ||
              config.agent.shellModel === LlmApiType.None // Check this last so notications get processed/cleared
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
              config.agent.shellModel,
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

      if (nextCommandAction == NextCommandAction.EndSession) {
        llmynx.clear();
        contextManager.clear();
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
    let pauseSeconds = config.agent.debugPauseSeconds;
    let wakeOnMessage = config.agent.wakeOnMessage;

    if (inputMode.isLLM()) {
      llmErrorCount++;

      // Set the pause seconds to exponential backoff, up to retrySecondsMax
      pauseSeconds = config.agent.debugPauseSeconds * 2 ** (llmErrorCount - 1);

      if (pauseSeconds > config.retrySecondsMax) {
        pauseSeconds = config.retrySecondsMax;
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
    if (!config.agent.subagentMax) {
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

  async function checkNewMailNotification() {
    if (!config.mailEnabled) {
      return false;
    }

    let supressMail = false;
    if (mailBlackoutCountdown > 0) {
      mailBlackoutCountdown--;
      supressMail = true;
    }

    // Check for unread threads
    const unreadThreads = await llmail.getUnreadThreads();
    if (!unreadThreads.length) {
      return false;
    }

    if (supressMail) {
      await output.commentAndLog(
        `New mail notifications blackout in effect. ${mailBlackoutCountdown} cycles remaining.`,
      );
      return true;
    }

    // Get the new messages for each thread
    const newMessages: string[] = [];
    for (const { thread_id, new_msg_id } of unreadThreads) {
      newMessages.push(await llmail.readThread(thread_id, new_msg_id, true));
    }

    // Check that token max for session will not be exceeded
    const newMsgTokenCount = newMessages.reduce(
      (acc, msg) => acc + utilities.getTokenCount(msg),
      0,
    );

    const sessionTokens = contextManager.getTokenCount();
    const tokenMax = config.agent.tokenMax;

    // Show full messages unless we are close to the token limit of the session
    // or in simple mode, which means non-threaded messages
    if (sessionTokens + newMsgTokenCount < tokenMax * 0.75) {
      for (const newMessage of newMessages) {
        await contextManager.append("New Message:", ContentSource.Console);
        await contextManager.append(newMessage, ContentSource.Console);
      }

      for (const unreadThread of unreadThreads) {
        await llmail.markAsRead(unreadThread.thread_id);
      }

      mailBlackoutCountdown = config.agent.mailBlackoutCycles || 0;
    } else if (llmail.simpleMode) {
      await contextManager.append(
        `You have new mail, but not enough context to read them.\n` +
          `After you 'endsession' and the context resets, you will be able to read them.`,
        ContentSource.Console,
      );
    }
    // LLM will in many cases end the session here, when the new session starts
    // this code will run again, and show a full preview of the messages
    else {
      const threadIds = unreadThreads.map((t) => t.thread_id).join(", ");

      await contextManager.append(
        `New Messages on Thread ID ${threadIds}\n` +
          `Use llmail read <id>' to read the thread, but be mindful you are close to the token limit for the session.`,
        ContentSource.Console,
      );
    }

    return true;
  }

  async function checkContextLimitWarning() {
    const tokenCount = contextManager.getTokenCount();
    const tokenMax = config.agent.tokenMax;

    if (tokenCount > tokenMax) {
      let tokenNote = "";

      if (config.endSessionEnabled) {
        tokenNote += `\nUse 'endsession <note>' to clear the console and reset the session.
    The note should help you find your bearings in the next session. 
    The note should contain your next goal, and important things should you remember.`;
      }

      if (config.trimSessionEnabled) {
        tokenNote += `\nUse 'trimsession' to reduce the size of the session.
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
    if (!config.trimSessionEnabled) {
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

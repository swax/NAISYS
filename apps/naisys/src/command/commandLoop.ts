import { LlmApiType, sleep, SUPER_ADMIN_USERNAME } from "@naisys/common";
import chalk from "chalk";
import * as readline from "readline";

import type { AgentConfig } from "../agent/agentConfig.js";
import type { DesktopService } from "../computer-use/desktop.js";
import type { LynxService } from "../features/lynx.js";
import type { SessionService } from "../features/session.js";
import type { WorkspacesFeature } from "../features/workspaces.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { HubClient } from "../hub/hubClient.js";
import type { ContextManager } from "../llm/contextManager.js";
import {
  SPEND_LIMIT_TIMEOUT_SECONDS,
  SpendLimitError,
} from "../llm/costTracker.js";
import { ContentSource } from "../llm/llmDtos.js";
import type { LLMService } from "../llm/llmService.js";
import type { DesktopAction } from "../llm/vendors/vendorTypes.js";
import type { ChatService } from "../mail/chat.js";
import type { MailService } from "../mail/mail.js";
import type { LogService } from "../services/logService.js";
import type { ModelService } from "../services/modelService.js";
import type { RunService } from "../services/runService.js";
import { createEscKeyListener } from "../utils/escKeyListener.js";
import type { InputModeService } from "../utils/inputMode.js";
import type { OutputService } from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import type { CommandHandler } from "./commandHandler.js";
import { NextCommandAction } from "./commandRegistry.js";
import type { PromptBuilder } from "./promptBuilder.js";
import type { ShellCommand } from "./shellCommand.js";

export function createCommandLoop(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  commandHandler: CommandHandler,
  promptBuilder: PromptBuilder,
  shellCommand: ShellCommand,
  lynxService: LynxService,
  contextManager: ContextManager,
  workspaces: WorkspacesFeature,
  llmService: LLMService,
  systemMessage: string,
  output: OutputService,
  logService: LogService,
  inputMode: InputModeService,
  runService: RunService,
  promptNotification: PromptNotificationService,
  localUserId: number,
  mailService: MailService,
  chatService: ChatService,
  hubClient: HubClient | undefined,
  sessionService: SessionService,
  modelService: ModelService,
  desktopService: DesktopService,
) {
  let preemptiveCompactTimeout: NodeJS.Timeout | undefined;
  /** Tracks the current wait so preemptive compact can calculate remaining time */
  let currentWait: { startTime: number; totalSeconds: number } | undefined;

  async function run(abortSignal?: AbortSignal): Promise<string> {
    output.commentAndLog(`AGENT STARTED`);

    // Show Agent Config exept the agent prompt
    output.commentAndLog(
      `Agent configured to use ${agentConfig().shellModel} model`,
    );

    // Show System Message
    output.commentAndLog("System Message:");
    output.write(systemMessage);
    logService.write({
      role: "system",
      content: systemMessage,
      type: "system",
    });

    let nextCommandAction = NextCommandAction.Continue;

    let llmErrorCount = 0;

    while (
      nextCommandAction !== NextCommandAction.ExitApplication &&
      nextCommandAction !== NextCommandAction.SessionComplete &&
      !abortSignal?.aborted
    ) {
      let pauseSeconds: number | undefined;

      ({ nextCommandAction, pauseSeconds } =
        await runSessionStartup(llmErrorCount));

      while (
        nextCommandAction == NextCommandAction.Continue &&
        !abortSignal?.aborted
      ) {
        ({ nextCommandAction, pauseSeconds, llmErrorCount } =
          await processOneIteration(pauseSeconds, llmErrorCount));
      }

      if (nextCommandAction == NextCommandAction.CompactSession) {
        clearTimeout(preemptiveCompactTimeout);
        lynxService.clear();
        contextManager.clear();
        await runService.incrementSession();
        nextCommandAction = NextCommandAction.Continue;
      }
    }

    clearTimeout(preemptiveCompactTimeout);

    if (abortSignal?.aborted) {
      output.commentAndLog(`AGENT STOPPED (${abortSignal.reason})`);
      return String(abortSignal.reason);
    } else if (nextCommandAction === NextCommandAction.SessionComplete) {
      output.commentAndLog(`AGENT SESSION COMPLETED`);
      return "session-complete";
    } else {
      output.commentAndLog(`AGENT EXITED`);
      return "exit";
    }
  }

  /**
   * Optimal point to compact context. Waiting longer wastes money on bloated reads;
   * compacting sooner wastes money generating summaries too often. Model min cacheable size agnostic.
   */
  const PREEMPTIVE_COMPACTION_THRESHOLD_TOKENS = 2400;
  const CACHE_EXPIRY_MARGIN_SECONDS = 30;

  function schedulePreemptiveCompact() {
    clearTimeout(preemptiveCompactTimeout);

    if (
      !globalConfig().compactSessionEnabled ||
      !globalConfig().preemptiveCompactEnabled ||
      shellCommand.isShellSuspended()
    ) {
      return;
    }

    const shellModel = agentConfig().shellModel;
    const model = modelService.getLlmModel(shellModel);
    const cacheTtl = model.cacheTtlSeconds;
    const lastQueryTime = contextManager.getLastQueryTime();

    if (
      !cacheTtl ||
      lastQueryTime <= 0 ||
      contextManager.getTokenCount() <= PREEMPTIVE_COMPACTION_THRESHOLD_TOKENS
    ) {
      return;
    }

    const cacheExpiresAt = lastQueryTime + cacheTtl * 1000;
    const compactAt = cacheExpiresAt - CACHE_EXPIRY_MARGIN_SECONDS * 1000;
    const compactAfterMs = compactAt - Date.now();

    if (compactAfterMs <= 0) {
      return;
    }

    preemptiveCompactTimeout = setTimeout(() => {
      let remainingSeconds = 0;
      if (currentWait) {
        const elapsed = Math.round((Date.now() - currentWait.startTime) / 1000);
        remainingSeconds = Math.max(0, currentWait.totalSeconds - elapsed);
      }

      promptNotification.notify({
        wake: "always",
        userId: localUserId,
        commands: [`ns-session preemptive-compact ${remainingSeconds}`],
      });
    }, compactAfterMs);
  }

  async function processNotifications(): Promise<string[]> {
    const result = await promptNotification.processPending(localUserId);
    for (const item of result.output) {
      if (item.type === "context") {
        contextManager.append(item.text, ContentSource.Console);
      } else if (item.type === "error") {
        output.errorAndLog(item.text);
      } else {
        output.commentAndLog(item.text);
      }
    }
    return result.commands;
  }

  async function runSessionStartup(llmErrorCount: number): Promise<{
    nextCommandAction: NextCommandAction;
    pauseSeconds: number | undefined;
  }> {
    let nextCommandAction = NextCommandAction.Continue;
    let pauseSeconds: number | undefined = undefined;

    // This ensures output is appended to the llm context
    inputMode.setLLM();

    if (globalConfig().supervisorUrl) {
      output.notice(`Supervisor available at ${globalConfig().supervisorUrl}`);
      output.notice(
        `  Sign in as '${SUPER_ADMIN_USERNAME}' with the password set during setup. Use --setup to change it.`,
      );
    }

    output.commentAndLog("Use ns-help to see all available commands, and @ to talk directly to agent");

    desktopService.logStartup();

    output.commentAndLog("Starting Context:");

    // Check for mail that arrived before/during startup (e.g. task mail)
    if (hubClient) {
      // After successful startup, the hub sends startup messages, so wait a second for that to happen
      await sleep(1000);
    }

    const initialCommands = [
      ...structuredClone(agentConfig().initialCommands),
      ...sessionService.getResumeCommands(),
    ];

    for (const initialCommand of initialCommands) {
      try {
        const prompt = await promptBuilder.getPrompt(0);

        contextManager.append(prompt, ContentSource.ConsolePrompt);

        ({ nextCommandAction, pauseSeconds } =
          await commandHandler.processCommand(prompt, [
            agentConfig().resolveConfigVars(initialCommand),
          ]));
      } catch (e) {
        handleErrorAndSwitchToDebugMode(e, llmErrorCount, true);
      }
    }

    // Even if mail/chat not enabled, we may be sent mail/chat from agents that do have it enabled, and we
    // need to receive these msgs and mark them as read as agents are auto-started to handle unread messages
    await mailService.checkAndNotify();
    await chatService.checkAndNotify();
    // Discard commands from startup notifications — they'll be picked up in the main loop
    await processNotifications();

    inputMode.setDebug();

    return { nextCommandAction, pauseSeconds };
  }

  type IterationResult = {
    nextCommandAction: NextCommandAction;
    pauseSeconds: number | undefined;
    llmErrorCount: number;
  };

  async function processOneIteration(
    pauseSeconds: number | undefined,
    llmErrorCount: number,
  ): Promise<IterationResult> {
    // If pauseSeconds was explicitly set (e.g. by a wait command or error backoff), use it;
    // otherwise fall back to the default based on current mode
    if (pauseSeconds === undefined) {
      // When llm model is set to none then we should hold indefinitely
      if (agentConfig().shellModel === LlmApiType.None) {
        pauseSeconds = 0;
      }
      // Unfocused agents keep processing commands without delay, unless pauseSeconds was expliclity set by a wait command or error backoff
      else if (!output.isConsoleEnabled() && inputMode.isDebug()) {
        inputMode.setLLM();
        pauseSeconds = -1;
      } else {
        pauseSeconds = agentConfig().debugPauseSeconds;
      }
    }

    // Must be after the mode switch above so the message is added to the right context LLM/Debug
    if (shellCommand.isShellSuspended()) {
      const elapsedTime = shellCommand.getCommandElapsedTimeString();
      const commandName = shellCommand.getCurrentCommandName();
      contextManager.append(
        `'${commandName}' has been running for ${elapsedTime}. Enter 'wait <seconds>' to continue waiting. 'kill' to terminate. Any other input will be sent directly to the running process.`,
        ContentSource.Console,
      );
    }

    const prompt = await promptBuilder.getPrompt(pauseSeconds);
    let commandList: string[] = [];
    let blankDebugInput = false;

    // Debug command prompt
    if (inputMode.isDebug()) {
      if (pauseSeconds > 0) {
        currentWait = { startTime: Date.now(), totalSeconds: pauseSeconds };
      }

      commandList = [
        await promptBuilder.getInput(`${prompt}`, pauseSeconds, () => {
          // User started typing — cancel preemptive compact since a new
          // LLM query will follow and reschedule with fresh timing
          clearTimeout(preemptiveCompactTimeout);
        }),
      ];

      currentWait = undefined;
      blankDebugInput = commandList[0].trim().length == 0;
    }
    // LLM command prompt
    else if (inputMode.isLLM()) {
      pauseSeconds = undefined;

      const result = await getLlmCommands(prompt, llmErrorCount);

      if (result.outcome === "skip") {
        return {
          nextCommandAction: NextCommandAction.Continue,
          llmErrorCount: result.llmErrorCount,
          pauseSeconds: result.pauseSeconds,
        };
      }

      if (result.outcome === "desktop") {
        await desktopService.confirmAndExecuteActions(
          result.desktop.textContent,
          result.desktop.actions,
        );
        return {
          nextCommandAction: NextCommandAction.Continue,
          pauseSeconds: undefined,
          llmErrorCount,
        };
      }

      commandList = result.commands;
    } else {
      throw `Unreachable: Invalid input mode`;
    }

    // Run the command
    try {
      const commandResult = await commandHandler.processCommand(
        prompt,
        commandList,
      );

      if (inputMode.isLLM()) {
        llmErrorCount = 0;
      }

      // If the user is in debug mode and they didn't enter anything, switch to LLM.
      // Also switch immediately if the command requested it (e.g. ns-talk).
      if (inputMode.isDebug() && (blankDebugInput || commandResult.switchToLLM)) {
        inputMode.setLLM();
      }
      // If in LLM mode, auto switch back to debug
      else if (inputMode.isLLM()) {
        inputMode.setDebug();
      }

      return {
        nextCommandAction: commandResult.nextCommandAction,
        pauseSeconds: commandResult.pauseSeconds,
        llmErrorCount,
      };
    } catch (e) {
      const errorResult = handleErrorAndSwitchToDebugMode(
        e,
        llmErrorCount,
        true,
      );
      return {
        nextCommandAction: NextCommandAction.Continue,
        llmErrorCount: errorResult.llmErrorCount,
        pauseSeconds: errorResult.pauseSeconds,
      };
    }
  }

  type LlmCommandsResult =
    | { outcome: "commands"; commands: string[] }
    | {
        outcome: "skip";
        llmErrorCount: number;
        pauseSeconds: number | undefined;
      }
    | {
        outcome: "desktop";
        desktop: {
          textContent: string;
          actions: DesktopAction[];
        };
      };

  async function getLlmCommands(
    prompt: string,
    llmErrorCount: number,
  ): Promise<LlmCommandsResult> {
    const shellModel = agentConfig().shellModel;
    const modelName = modelService.getLlmModel(shellModel)?.label || shellModel;

    const workingMsg =
      prompt + chalk[OutputColor.loading](`LLM (${modelName}) Working...`);

    let commands: string[] = [];

    // Check for pending notifications that should interrupt
    if (
      promptNotification.hasPending(localUserId, true) ||
      shellModel === LlmApiType.None // Check this last so notifications get processed/cleared
    ) {
      const notificationCommands = await processNotifications();

      // If notifications carry commands (e.g. preemptive compact), run them directly
      if (notificationCommands.length > 0) {
        commands = notificationCommands;
      } else {
        inputMode.setDebug();
        return { outcome: "skip", llmErrorCount, pauseSeconds: undefined };
      }
    }

    checkContextLimitWarning();

    if (agentConfig().workspacesEnabled && workspaces.hasFiles()) {
      output.comment(workspaces.listFiles());
    }

    contextManager.append(prompt, ContentSource.ConsolePrompt);

    // If commands were generated from notifications, skip the LLM query and run them directly,
    // most often ns-session preemptive-compact commands from the preemptive compact notification
    if (commands.length > 0) {
      return { outcome: "commands", commands };
    }

    try {
      if (output.isConsoleEnabled()) {
        process.stdout.write(workingMsg);
      }

      // Set up ESC key cancellation for LLM query
      const queryController = new AbortController();
      let stopEscListener = () => {};

      // Only set up ESC listener if agent is in focus to avoid interfering with readline
      if (output.isConsoleEnabled()) {
        const escListener = createEscKeyListener();
        stopEscListener = escListener.start(() => {
          queryController.abort();
        });
      }

      let queryCancelled = false;
      try {
        const queryResult = await llmService.query(
          shellModel,
          systemMessage,
          contextManager.getCombinedMessages(),
          "console",
          queryController.signal,
        );

        // Clear "Working..." immediately so any subsequent output
        // (token warnings, desktop requests, etc.) starts on a clean line
        clearPromptMessage(workingMsg);

        contextManager.setMessagesTokenCount(queryResult.messagesTokenCount);
        schedulePreemptiveCompact();

        // Desktop actions: return for confirmation and execution
        if (queryResult.desktopActions?.length) {
          return {
            outcome: "desktop",
            desktop: {
              textContent: queryResult.responses.join("\n"),
              actions: queryResult.desktopActions,
            },
          };
        }

        commands = queryResult.responses;
      } catch (queryError) {
        // Check if this was an ESC cancellation
        if (queryController.signal.aborted) {
          queryCancelled = true;
        } else {
          throw queryError; // Re-throw non-abort errors
        }
      } finally {
        stopEscListener();
      }

      // Handle ESC cancellation
      if (queryCancelled) {
        clearPromptMessage(workingMsg);
        output.commentAndLog("LLM query cancelled by ESC");
        inputMode.setDebug();
        return { outcome: "skip", llmErrorCount, pauseSeconds: undefined };
      }
    } catch (e) {
      // Clear "Working..." before printing error output
      clearPromptMessage(workingMsg);

      // Check if the error is a bad request (400) that might be caused by media content
      // in the context (e.g. mismatched MIME type). Scrub non-text content from recent
      // user messages so the agent can recover instead of getting stuck in an error loop.
      const errorStr = `${e}`;
      if (errorStr.includes("400") && contextManager.scrubRecentMedia()) {
        output.errorAndLog(
          `Attempting Context Recovery: Recent media scrubbed from context due to API error: ${errorStr}`,
        );
        contextManager.append(
          `System: Recent media was scrubbed from the context because it caused an API error: ${errorStr.slice(0, 150)}`,
        );
        return { outcome: "skip", llmErrorCount, pauseSeconds: undefined };
      }

      const errorResult = handleErrorAndSwitchToDebugMode(
        e,
        llmErrorCount,
        false,
      );
      return {
        outcome: "skip",
        llmErrorCount: errorResult.llmErrorCount,
        pauseSeconds: errorResult.pauseSeconds,
      };
    }

    return { outcome: "commands", commands };
  }

  function clearPromptMessage(_waitingMessage: string) {
    if (output.isConsoleEnabled()) {
      // Use cursorTo + clearLine instead of precise cursor math — robust
      // even if unexpected output was written to stdout during the query
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    }
  }

  /** Name is comically long because of a prettier formatting issue when the name is too short */
  function handleErrorAndSwitchToDebugMode(
    e: unknown,
    llmErrorCount: number,
    addToContext: boolean,
  ) {
    const maxErrorLength = 200;
    const errorMsg = `${e}`;

    if (addToContext) {
      contextManager.append(errorMsg.slice(0, maxErrorLength));

      if (errorMsg.length > maxErrorLength) {
        contextManager.append("...");
        output.errorAndLog(
          `Error too long for context: ${errorMsg.slice(200)}`,
        );
      }
    } else {
      output.errorAndLog(errorMsg);
    }

    // If llm is in some error loop then hold in debug mode
    let pauseSeconds = agentConfig().debugPauseSeconds;

    if (inputMode.isLLM()) {
      if (e instanceof SpendLimitError) {
        // Spend limit errors use a constant timeout since they resolve on a schedule
        pauseSeconds = SPEND_LIMIT_TIMEOUT_SECONDS;
      } else {
        llmErrorCount++;

        // Set the pause seconds to exponential backoff, up to retrySecondsMax
        pauseSeconds =
          agentConfig().debugPauseSeconds * 2 ** (llmErrorCount - 1);

        if (pauseSeconds > globalConfig().retrySecondsMax) {
          pauseSeconds = globalConfig().retrySecondsMax;
          llmErrorCount--; // Prevent overflowing the calculation above
        }
      }
    }

    inputMode.setDebug();

    return {
      llmErrorCount,
      pauseSeconds,
    };
  }

  function checkContextLimitWarning() {
    const tokenCount = contextManager.getTokenCount();
    const tokenMax = agentConfig().tokenMax;

    if (tokenCount > tokenMax) {
      let tokenNote = "";

      if (globalConfig().compactSessionEnabled) {
        tokenNote += `\nUse 'ns-session compact' to reduce the token usage of the session.`;
      }

      contextManager.append(
        `The token limit for this session has been exceeded.${tokenNote}`,
        ContentSource.Console,
      );
    }
  }

  return {
    run,
    cleanup: () => clearTimeout(preemptiveCompactTimeout),
  };
}

export type CommandLoop = ReturnType<typeof createCommandLoop>;

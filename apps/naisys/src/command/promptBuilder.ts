import chalk from "chalk";

import type { AgentConfig } from "../agent/agentConfig.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { ContextManager } from "../llm/contextManager.js";
import type { CostTracker } from "../llm/costTracker.js";
import type { PlatformConfig } from "../services/shellPlatform.js";
import { isElevated } from "../services/shellPlatform.js";
import type { InputModeService } from "../utils/inputMode.js";
import type { OutputService } from "../utils/output.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import { getSharedReadline } from "../utils/sharedReadline.js";
import type { ShellWrapper } from "./shellWrapper.js";

export function createPromptBuilder(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  shellWrapper: ShellWrapper,
  contextManager: ContextManager,
  costTracker: CostTracker,
  output: OutputService,
  inputMode: InputModeService,
  platformConfig: PlatformConfig,
  promptNotification: PromptNotificationService,
  localUserId: number,
) {
  async function getPrompt(pauseSeconds: number) {
    const promptSuffix = isElevated()
      ? platformConfig.adminPromptSuffix
      : platformConfig.promptSuffix;

    const tokenMax = agentConfig().tokenMax;
    const usedTokens = contextManager.getTokenCount();
    const tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;

    let pause = "";

    if (inputMode.isDebug()) {
      if (pauseSeconds > 0) {
        pause += ` [Wait: ${pauseSeconds}s]`;
      }
      if (agentConfig().wakeOnMessage) {
        pause += " [WakeOnMsg]";
      }
    }

    const now = new Date();
    const timestamp =
      now.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) +
      " " +
      now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

    const budgetLeft = costTracker.getBudgetLeft();
    const budgetSuffix =
      budgetLeft !== null ? ` [Budget: $${budgetLeft.toFixed(2)}]` : "";

    return `[${timestamp}] ${await getUserHostPathPrompt()}${tokenSuffix}${budgetSuffix}${pause}${promptSuffix} `;
  }

  async function getUserHostPathPrompt() {
    const currentPath = await shellWrapper.getCurrentPath();

    return `${getUserHostPrompt()}${platformConfig.promptDivider}${currentPath}`;
  }

  function getUserHostPrompt() {
    return `${agentConfig().username}@${globalConfig().hostname}`;
  }

  function getInput(commandPrompt: string, pauseSeconds: number) {
    return new Promise<string>((resolve) => {
      const questionController = new AbortController();
      let timeout: NodeJS.Timeout | undefined;
      let notificationInterval: NodeJS.Timeout | undefined;
      let timeoutCancelled = false;
      let unsubscribeInput: (() => void) | undefined;

      function clearTimers() {
        timeoutCancelled = true;
        if (unsubscribeInput) {
          unsubscribeInput();
          unsubscribeInput = undefined;
        }

        clearTimeout(timeout);
        clearInterval(notificationInterval);
      }

      /**
       * Using a shared readline interface singleton to avoid conflicts when multiple agents are running.
       * Only one agent should be active on the console at a time (controlled by output.isWriteEnabled).
       */
      const readlineInterface = output.isConsoleEnabled()
        ? getSharedReadline()
        : undefined;

      /** Cancels waiting for user input */
      const cancelWaitingForUserInput = (questionAborted: boolean) => {
        if (timeoutCancelled) {
          return;
        }

        clearTimers();

        if (questionAborted) {
          return;
        }
        // Else timeout interrupted by user input

        // Update the prompt to remove timeout information so the user
        // doesn't think the timeout is still active
        if (readlineInterface) {
          const newPrompt = commandPrompt.replace(/\s*\[Wait: \d+s\]/, "");

          readlineInterface.setPrompt(chalk.greenBright(newPrompt));
          (readlineInterface as any)._refreshLine();
        }
      };

      if (readlineInterface) {
        readlineInterface.question(
          chalk.greenBright(commandPrompt),
          { signal: questionController.signal },
          (answer) => {
            clearTimers();
            readlineInterface.pause();
            resolve(answer);
          },
        );

        // If user presses any key, cancel auto-continue timers and/or wake on msg
        const onStdinData = () => cancelWaitingForUserInput(false);
        process.stdin.on("data", onStdinData);
        unsubscribeInput = () =>
          process.stdin.removeListener("data", onStdinData);
      } else {
        // Agent not in focus - just output to buffer and wait for events
        // Don't actively cycle with timeouts as stdout writes interfere with readline
        output.comment(commandPrompt + "<agent not in focus>");
      }

      function abortQuestion() {
        cancelWaitingForUserInput(true);
        questionController.abort();
        try {
          readlineInterface?.pause();
        } catch {
          // On Windows, the readline interface may already be closed after abort
        }
        resolve("");
      }

      // This pauses the app for a specified time before the next llm call
      // This is how `ns-session wait` is implemented
      // It also allows the user to wake the debug prompt on incoming mail or switching the in focus agent
      if (pauseSeconds > 0) {
        timeout = setTimeout(abortQuestion, pauseSeconds * 1000);
      }

      // Poll for prompt notifications that should wake/interrupt
      notificationInterval = setInterval(() => {
        if (
          promptNotification.hasPending(
            localUserId,
            agentConfig().wakeOnMessage,
          )
        ) {
          abortQuestion();
        }
      }, 250);
    });
  }

  return {
    getPrompt,
    getUserHostPathPrompt,
    getUserHostPrompt,
    getInput,
  };
}

export type PromptBuilder = ReturnType<typeof createPromptBuilder>;

import chalk from "chalk";
import * as readline from "readline";
import * as llmail from "../apps/llmail.js";
import * as config from "../config.js";
import * as contextManager from "../llm/contextManager.js";
import { ContentSource } from "../llm/contextManager.js";
import { LlmRole } from "../llm/llmDtos.js";
import * as llmService from "../llm/llmService.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as logService from "../utils/logService.js";
import * as output from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import * as commandHandler from "./commandHandler.js";
import { NextCommandAction } from "./commandHandler.js";
import * as promptBuilder from "./promptBuilder.js";

const maxErrorCount = 5;

export async function run() {
  // Show Agent Config exept the agent prompt
  await output.commentAndLog(
    `Agent configured to use ${config.agent.consoleModel} model`,
  );

  // Show System Message
  await output.commentAndLog("System Message:");
  const systemMessage = contextManager.getSystemMessage();
  output.write(systemMessage);
  await logService.write({
    role: LlmRole.System,
    content: systemMessage,
    type: "system",
  });

  let nextCommandAction = NextCommandAction.Continue;

  let llmErrorCount = 0;

  while (nextCommandAction != NextCommandAction.ExitApplication) {
    inputMode.toggle(InputMode.LLM);

    await output.commentAndLog("Starting Context:");
    await contextManager.append("Previous Session Note:");
    await contextManager.append(commandHandler.previousSessionNotes || "None");

    await commandHandler.consoleInput(
      await promptBuilder.getPrompt(),
      "llmail help",
    );

    await commandHandler.consoleInput(
      await promptBuilder.getPrompt(),
      "llmail users",
    );

    inputMode.toggle(InputMode.Debug);

    let pauseSeconds = config.agent.debugPauseSeconds;
    let wakeOnMessage = config.agent.wakeOnMessage;

    while (nextCommandAction == NextCommandAction.Continue) {
      const prompt = await promptBuilder.getPrompt(pauseSeconds, wakeOnMessage);
      let input = "";

      // Debug command prompt
      if (inputMode.current === InputMode.Debug) {
        input = await promptBuilder.getInput(
          `${prompt}`,
          pauseSeconds,
          wakeOnMessage,
        );
      }
      // LLM command prompt
      else if (inputMode.current === InputMode.LLM) {
        const workingMsg =
          prompt +
          chalk[output.OutputColor.loading](
            `LLM (${config.agent.consoleModel}) Working...`,
          );

        try {
          await displayNewMail();

          await contextManager.append(prompt, ContentSource.ConsolePrompt);

          process.stdout.write(workingMsg);

          input = await llmService.query(
            config.agent.consoleModel,
            contextManager.getSystemMessage(),
            contextManager.messages,
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
        throw `Invalid input mode: ${inputMode.current}`;
      }

      // Run the command
      try {
        ({ nextCommandAction, pauseSeconds, wakeOnMessage } =
          await commandHandler.consoleInput(prompt, input));

        if (inputMode.current == InputMode.LLM) {
          llmErrorCount = 0;
        }
      } catch (e) {
        ({ llmErrorCount, pauseSeconds, wakeOnMessage } =
          await handleErrorAndSwitchToDebugMode(e, llmErrorCount, true));
        continue;
      }

      // If the user is in debug mode and they didn't enter anything, switch to LLM
      // If in LLM mode, auto switch back to debug
      if (
        (inputMode.current == InputMode.Debug && !input) ||
        inputMode.current == InputMode.LLM
      ) {
        inputMode.toggle();
      }
    }

    if (nextCommandAction == NextCommandAction.EndSession) {
      contextManager.clear();
      nextCommandAction = NextCommandAction.Continue;
    }
  }
}

function clearPromptMessage(waitingMessage: string) {
  readline.moveCursor(process.stdout, -waitingMessage.length, 0);
  process.stdout.write(" ".repeat(waitingMessage.length));
  readline.moveCursor(process.stdout, -waitingMessage.length, 0);
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

  if (inputMode.current == InputMode.LLM) {
    llmErrorCount++;

    if (llmErrorCount >= maxErrorCount) {
      pauseSeconds = 0;
      wakeOnMessage = false;

      if (llmErrorCount == maxErrorCount) {
        await output.errorAndLog(`Too many LLM errors. Holding in debug mode.`);
      }
    }
  }

  inputMode.toggle(InputMode.Debug);

  return {
    llmErrorCount,
    pauseSeconds,
    wakeOnMessage,
  };
}

async function displayNewMail() {
  // Check for unread threads
  const unreadThreads = await llmail.getUnreadThreads();
  if (!unreadThreads.length) {
    return;
  }

  // Get the new messages for each thread
  const newMessages: string[] = [];
  for (const { threadId, newMsgId } of unreadThreads) {
    newMessages.push(await llmail.readThread(threadId, newMsgId, true));
  }

  // Check that token max for session will not be exceeded
  const newMsgTokenCount = newMessages.reduce(
    (acc, msg) => acc + utilities.getTokenCount(msg),
    0,
  );

  const sessionTokens = contextManager.getTokenCount();
  const tokenMax = config.tokenMax;

  // Show full messages unless we are close to the token limit of the session
  // or in simple mode, which means non-threaded messages
  if (sessionTokens + newMsgTokenCount < tokenMax * 0.75) {
    for (const newMessage of newMessages) {
      await contextManager.append("New Message:", ContentSource.Console);
      await contextManager.append(newMessage, ContentSource.Console);
    }

    for (const unreadThread of unreadThreads) {
      await llmail.markAsRead(unreadThread.threadId);
    }
  } else if (llmail.simpleMode) {
    await contextManager.append(
      `You have new mail, but not enough context to read them.\n` +
        `Finish up what you're doing. After you 'endsession' and the context resets, you will be able to read them.`,
      ContentSource.Console,
    );
  }
  // LLM will in many cases end the session here, when the new session starts
  // this code will run again, and show a full preview of the messages
  else {
    const threadIds = unreadThreads.map((t) => t.threadId).join(", ");

    await contextManager.append(
      `New Messages on Thread ID ${threadIds}\n` +
        `Use llmail read <id>' to read the thread, but be mindful you are close to the token limit for the session.`,
      ContentSource.Console,
    );
  }
}

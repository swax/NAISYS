import chalk from "chalk";
import * as readline from "readline";
import * as llmail from "../apps/llmail.js";
import * as config from "../config.js";
import * as contextLog from "../llm/contextLog.js";
import { LlmRole } from "../llm/contextLog.js";
import * as contextManager from "../llm/contextManager.js";
import { ContentSource } from "../llm/contextManager.js";
import * as llmService from "../llm/llmService.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import * as commandHandler from "./commandHandler.js";
import { NextCommandAction } from "./commandHandler.js";
import * as promptBuilder from "./promptBuilder.js";

export async function run() {
  output.comment("System Message:");
  const systemMessage = contextManager.getSystemMessage();
  output.write(systemMessage);
  await contextLog.write({
    role: LlmRole.System,
    content: systemMessage,
  });

  let nextCommandAction = NextCommandAction.Continue;

  while (nextCommandAction != NextCommandAction.ExitApplication) {
    inputMode.toggle(InputMode.LLM);

    output.comment("Starting Context:");
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

    while (nextCommandAction == NextCommandAction.Continue) {
      const prompt = await promptBuilder.getPrompt(pauseSeconds);
      let input = "";

      // Debug runs in a shadow mode
      if (inputMode.current === InputMode.Debug) {
        input = await promptBuilder.getInput(`${prompt}`, pauseSeconds);
      }
      // When LLM runs input/output is added to the context
      else if (inputMode.current === InputMode.LLM) {
        await showNewMail();

        await contextManager.append(prompt, ContentSource.StartPrompt);

        const waitingMessage =
          prompt +
          chalk[output.OutputColor.loading](
            `LLM (${config.agent.consoleModel}) Working...`,
          );
        process.stdout.write(waitingMessage);

        const clearWaitingMessage = () => {
          readline.moveCursor(process.stdout, -waitingMessage.length, 0);
          process.stdout.write(" ".repeat(waitingMessage.length));
          readline.moveCursor(process.stdout, -waitingMessage.length, 0);
        };

        try {
          input = await llmService.send();
          clearWaitingMessage();
        } catch (e) {
          clearWaitingMessage();
          output.error(`${e}`);
        }
      }

      try {
        ({ nextCommandAction, pauseSeconds } =
          await commandHandler.consoleInput(prompt, input));
      } catch (e) {
        const maxErrorLength = 200;
        const errorMsg = `${e}`;

        await contextManager.append(errorMsg.slice(0, maxErrorLength));

        if (errorMsg.length > maxErrorLength) {
          await contextManager.append("...");
          output.error(`Error too long for context: ${errorMsg.slice(200)}`);
        }
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

  await output.comment("NAISYS Terminated");
}

async function showNewMail() {
  try {
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
  } catch (e) {
    output.error(`Error getting notifications: ${e}`);
  }
}

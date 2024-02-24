import chalk from "chalk";
import * as readline from "readline";
import * as llmail from "./apps/llmail.js";
import * as commandHandler from "./commandHandler.js";
import { NextCommandAction } from "./commandHandler.js";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import { ContentSource } from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as llmService from "./llmService.js";
import * as output from "./output.js";
import * as promptBuilder from "./promptBuilder.js";
import * as utilities from "./utilities.js";

export async function run() {
  let nextCommandAction = NextCommandAction.Continue;

  while (nextCommandAction != NextCommandAction.ExitApplication) {
    inputMode.toggle(InputMode.LLM);

    output.comment("System Message:");
    output.write(llmService.getSystemMessage());

    output.comment("First Prompt:");
    await contextManager.append(`NAISYS 1.0 Shell
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
  Make sure to call endsession before the limit is hit so you can continue your work with a fresh console
Previous session notes: 
  ${commandHandler.previousSessionNotes || "None"}
`);

    await commandHandler.consoleInput(
      await promptBuilder.getPrompt(),
      "llmail help",
    );

    await commandHandler.consoleInput(
      await promptBuilder.getPrompt(),
      "llmail users",
    );

    inputMode.toggle(InputMode.Debug);

    let pauseSeconds = config.debugPauseSeconds;

    while (nextCommandAction == NextCommandAction.Continue) {
      const prompt = await promptBuilder.getPrompt(pauseSeconds);
      let input = "";

      // Root runs in a shadow mode
      if (inputMode.current === InputMode.Debug) {
        input = await promptBuilder.getInput(`${prompt}`, pauseSeconds);
      }
      // When LLM runs input/output is added to the context
      else if (inputMode.current === InputMode.LLM) {
        await showNewMail();

        await contextManager.append(prompt, ContentSource.StartPrompt);

        const waitingMessage =
          prompt + chalk[output.OutputColor.loading]("LLM Working...");
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
    if (sessionTokens + newMsgTokenCount < tokenMax * 0.75) {
      for (const newMessage of newMessages) {
        await contextManager.append("New Message:", ContentSource.Console);
        await contextManager.append(newMessage, ContentSource.Console);
      }

      for (const unreadThread of unreadThreads) {
        await llmail.markAsRead(unreadThread.threadId);
      }
    }
    // LLM will in many cases end the session here, when the new session starts
    // this code will run again, and show a full preview of the messages
    else {
      const threadIds = unreadThreads.map((t) => t.threadId).join(", ");

      await contextManager.append(
        `New Messages on Thread ID ${threadIds}
Use 'llmail read <id>' to read the thread, but be mindful you are close to the token limit for the session.`,
        ContentSource.Console,
      );
    }
  } catch (e) {
    output.error(`Error getting notifications: ${e}`);
  }
}

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

export async function run() {
  let nextCommandAction = NextCommandAction.Continue;

  while (nextCommandAction != NextCommandAction.ExitApplication) {
    inputMode.toggle(InputMode.LLM);

    output.comment("System Message:");
    output.write(llmService.getSystemMessage());

    output.comment("First Prompt:");
    contextManager.append(`NAISYS 1.0 Shell
Welcome back ${config.agent.username}!
MOTD:
Date: ${new Date().toUTCString()}
Commands: 
  Standard Unix commands are available
  vi and nano are not supported
  Read/write entire files with cat
  Do not input notes after the prompt. Only valid commands.
Special Commands:
  comment <thought>: Any non-command output like thinking out loud, prefix with the 'comment' command
  talk <user> <message>: Use this command to send a message to another user
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

    await commandHandler.consoleInput(await promptBuilder.getPrompt(), "ls");

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
        await showMailNotifiactions();

        contextManager.append(prompt, ContentSource.StartPrompt);

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

        contextManager.append(errorMsg.slice(0, maxErrorLength));

        if (errorMsg.length > maxErrorLength) {
          contextManager.append("...");
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

  output.comment("NAISYS Terminated");
}

async function showMailNotifiactions() {
  try {
    const llmailNotifiactions = await llmail.getNotifications();
    if (llmailNotifiactions) {
      contextManager.append(llmailNotifiactions, ContentSource.Console);
    }
  } catch (e) {
    output.error(`Error getting notifications: ${e}`);
  }
}

import chalk from "chalk";
import * as readline from "readline";
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

const _readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export async function run() {
  let nextCommandAction = NextCommandAction.Continue;

  while (nextCommandAction != NextCommandAction.ExitApplication) {
    inputMode.toggle(InputMode.LLM);

    contextManager.append(`NAISYS 1.0 Shell
Welcome back ${config.username}!
MOTD:
Date: ${new Date().toUTCString()}
Standard Unix Commands available.
  vi and nano are not supported
  Read/write entire files with cat and echo
Special Commands:
  suggest <note>: Suggest something to be implemented for the next cycle
  talk <user> <message>: Use this command to send a message to another user
  endsession <note>: Ends this session, clears the console log. Add notes to carry over to the next session
The console log can only hold a certain number of 'tokens' that is specified in the prompt
  Make sure to call endsession before the limit is hit to you can continue your work with a fresh console
Previous session notes: ${commandHandler.previousSessionNotes || "None"}
`);

    await commandHandler.consoleInput(await promptBuilder.getPrompt(), "ls");

    inputMode.toggle(InputMode.Debug);

    while (nextCommandAction == NextCommandAction.Continue) {
      const prompt = await promptBuilder.getPrompt();
      let input = "";

      // Root runs in a shadow mode
      if (inputMode.current === InputMode.Debug) {
        input = await _getInput(`${prompt}`);
      }
      // When LLM runs input/output is added to the context
      else if (inputMode.current === InputMode.LLM) {
        contextManager.append(prompt, ContentSource.StartPrompt);

        const waitingMessage =
          prompt + chalk[output.OutputColor.loading]("LLM Working...");
        process.stdout.write(waitingMessage);

        const llmResponse = await llmService.send();

        // erase waiting message
        readline.moveCursor(process.stdout, -waitingMessage.length, 0);
        process.stdout.write(" ".repeat(waitingMessage.length));
        readline.moveCursor(process.stdout, -waitingMessage.length, 0);

        if (llmResponse.error) {
          output.error(llmResponse.value);
        } else {
          input = llmResponse.value;
        }
      }

      nextCommandAction = await commandHandler.consoleInput(prompt, input);

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

function _getInput(query: string) {
  return new Promise<string>((resolve) => {
    _readlineInterface.question(chalk.greenBright(query), (answer) => {
      resolve(answer);
    });
  });
}

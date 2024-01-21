import chalk from "chalk";
import * as readline from "readline";
import * as commandService from "./commandService.js";
import { NextCommandAction } from "./commandService.js";
import * as consoleService from "./consoleService.js";
import * as contextService from "./contextService.js";
import * as envService from "./envService.js";
import * as inputModeService from "./inputModeService.js";
import { InputMode } from "./inputModeService.js";
import * as llmService from "./llmService.js";
import * as promptService from "./promptService.js";

const _readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export async function run() {
  let nextCommandAction = NextCommandAction.Continue;

  while (nextCommandAction != NextCommandAction.ExitApplication) {
    inputModeService.toggle(InputMode.LLM);

    contextService.append(`NAISYS 1.0 Shell
Welcome back ${envService.username}!
MOTD:
Date: ${new Date().toUTCString()}
Standard Unix Commands available. 
  vi and nano are not supported. 
  Read/write entire files with cat and echo.
Special Commands:
  suggest <note>: Suggest something to be implemented for the next cycle
  talk <user> <message>: Use this command to send a message to another user
  endsession <note>: Ends this session, clears the console log. Add notes to carry over to the next session
The console log can only hold a certain number of 'tokens' that is specified in the prompt.
  Make sure to call endsession before the limit is hit to you can continue your work with a fresh console.
Previous session notes: ${commandService.previousSessionNotes || "None"}
`);

    await commandService.handleConsoleInput(
      await promptService.getPrompt(),
      "ls",
    );

    inputModeService.toggle(InputMode.Debug);

    while (nextCommandAction == NextCommandAction.Continue) {
      const prompt = await promptService.getPrompt();
      let input = "";

      // Root runs in a shadow mode
      if (inputModeService.current === InputMode.Debug) {
        input = await _getInput(`${prompt}`);
      }
      // When LLM runs input/output is added to the context
      else if (inputModeService.current === InputMode.LLM) {
        contextService.append(prompt, "startPrompt");

        input = await llmService.send();
      }

      nextCommandAction = await commandService.handleConsoleInput(
        prompt,
        input,
      );

      // If the user is in debug mode and they didn't enter anything, switch to LLM
      // If in LLM mode, auto switch back to debug
      if (
        (inputModeService.current == InputMode.Debug && !input) ||
        inputModeService.current == InputMode.LLM
      ) {
        inputModeService.toggle();
      }
    }

    if (nextCommandAction == NextCommandAction.EndSession) {
      contextService.clear();
      nextCommandAction = NextCommandAction.Continue;
    }
  }

  consoleService.comment("NAISYS Terminated");
}

function _getInput(query: string) {
  return new Promise<string>((resolve) => {
    _readlineInterface.question(chalk.greenBright(query), (answer) => {
      resolve(answer);
    });
  });
}

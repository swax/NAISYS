import * as readline from "readline";
import {
  NextCommandAction,
  commandService,
} from "./services/commandService.js";
import { contextService } from "./services/contextService.js";
import { gptService } from "./services/gptService.js";
import { envService } from "./services/envService.js";
import { promptService } from "./services/promptService.js";
import { consoleService } from "./services/consoleService.js";
import chalk from "chalk";
import { InputMode } from "./enums.js";
import { realShellService } from "./services/real-shell/realShellService.js";

const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const getInput = (query: string) => {
  return new Promise<string>((resolve) => {
    readlineInterface.question(chalk.greenBright(query), (answer) => {
      resolve(answer);
    });
  });
};

consoleService.comment("File System set to: " + realShellService.getName());

let nextCommandAction = NextCommandAction.Continue;

while (nextCommandAction != NextCommandAction.ExitApplication) {
  envService.toggleInputMode(InputMode.LLM);

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
Previous session notes: ${envService.previousSessionNotes || "None"}
`);

  contextService.append((await promptService.getPrompt()) + "ls");
  await realShellService.handleCommand("ls", []);

  envService.toggleInputMode(InputMode.Debug);

  while (nextCommandAction == NextCommandAction.Continue) {
    const prompt = await promptService.getPrompt();
    let input = "";

    // Root runs in a shadow mode
    if (envService.inputMode === InputMode.Debug) {
      input = await getInput(`${prompt}`);
    }
    // When GPT runs input/output is added to the context
    else if (envService.inputMode === InputMode.LLM) {
      contextService.append(prompt, "startPrompt");

      input = await gptService.send();
    }

    nextCommandAction = await commandService.handleConsoleInput(prompt, input);

    // If the user is in debug mode and they didn't enter anything, switch to LLM
    // If in LLM mode, auto switch back to debug
    if (
      (envService.inputMode == InputMode.Debug && !input) ||
      envService.inputMode == InputMode.LLM
    ) {
      envService.toggleInputMode();
    }
  }

  if (nextCommandAction == NextCommandAction.EndSession) {
    contextService.clear();
    nextCommandAction = NextCommandAction.Continue;
  }
}

consoleService.comment("NAISYS Terminated");

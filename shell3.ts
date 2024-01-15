import * as readline from "readline";
import { commandService } from "./services/commandService.js";
import { contextService } from "./services/contextService.js";
import { gptService } from "./services/gptService.js";
import { envService } from "./services/envService.js";
import { promptService } from "./services/promptService.js";
import { consoleService } from "./services/consoleService.js";
import { fileSystemService } from "./services/file-system/fileSystemService.js";

const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const getInput = (query: string) => {
  return new Promise<string>((resolve) => {
    readlineInterface.question(query, (answer) => {
      resolve(answer);
    });
  });
};

consoleService.comment("File System set to: " + fileSystemService.getName());

while (true) {
  envService.toggleInputMode("gpt");
  contextService.append(`NAISYS 1.0 Shell
Welcome back ${envService.username}!
MOTD:
  Date: ${new Date().toUTCString()}
  Standard Unix Commands available. 
  Enter one command at a time, or separate multiple commands with a semicolon.
  Special Commands:
    suggest <note>: Suggest something to be implemented for the next cycle
    talk <user> <message>: Use this command to send a message to another user
    endsession <note>: Ends this session, clears the console log. Add notes to carry over to the next session
  Previous session notes: ${envService.previousSessionNotes}`);
  envService.toggleInputMode("root");

  let endcycle = false;

  while (!endcycle) {
    let prompt = await promptService.getPrompt();
    let input = "";

    // Root runs in a shadow mode
    if (envService.inputMode === "root") {
      input = await getInput(`${prompt}`);
    }
    // When GPT runs input/output is added to the context
    else if (envService.inputMode === "gpt") {
      contextService.append(prompt, "startPrompt");

      input = await gptService.send();
    }

    endcycle = await commandService.handleConsoleInput(prompt, input);

    if (endcycle) {
      contextService.clear();
    }

    if (
      (envService.inputMode == "root" && !input) ||
      envService.inputMode == "gpt"
    ) {
      envService.toggleInputMode();
    }
  }
}

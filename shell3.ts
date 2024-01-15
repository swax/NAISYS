import * as readline from "readline";
import { commandService } from "./services/commandService.js";
import { contextService } from "./services/contextService.js";
import { inMemoryFileSystem } from "./services/inMemoryFileSystemService.js";
import { gptService } from "./services/gptService.js";
import { envService } from "./services/envService.js";

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

while (true) {
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

  let endcycle = false;

  while (!endcycle) {
    // Get root input - hidden from context
    // Accept root commands until a blank one is entered
    let rootInput = "...";
    while (rootInput) {
      rootInput = await getInput(
        `\nroot@${envService.hostname}:${inMemoryFileSystem.getCurrentPath()}# `
      );

      const rootCommand = rootInput.trim().split(" ")[0];
      if (!rootCommand) continue;

      switch (rootCommand) {
        case "talk":
          const talkMsg = rootInput.trim().split(" ").slice(1).join(" ");
          contextService.append(
            `Broadcast Message from root@${envService.hostname}: ${talkMsg}`
          );
          break;
        case "context":
          console.log("#####################");
          console.log(contextService.context);
          console.log("#####################`");
          break;
        default:
          console.log("Invalid root command");
      }
    }
    console.log("");

    const gptPrompt = `${envService.getPromptPrefix()}:${inMemoryFileSystem.getCurrentPath()}$ `;

    contextService.append(gptPrompt, "startPrompt");

    const gptConsoleInput = await gptService.send();

    endcycle = commandService.handleConsoleInput(gptPrompt, gptConsoleInput);
  }
}

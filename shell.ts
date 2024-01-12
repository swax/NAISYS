import * as readline from "readline";
import OpenAI from "openai";
import { memoryTreeToString, deleteMemoryBranch, addMemoryLeaf } from "./services/memoryTreeService";

require("dotenv").config();

if (process.env.OPENAI_API_KEY === undefined) {
  console.log("Error: OPENAI_API_KEY is not defined");
}

const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// output welcome
console.log(`Welcome to NAISYS (Node.js Autonomous Intelligence System)
Commands:
  ask_gpt <question>: Ask GPT-3 a question
  mail: Checks your mail for messages
  xxccdd: Do not use this command yet
  wait: Take a break and wait for a while
  suggestion: Suggest a command for adding to the system
  unix commands: ls, cd, mkdir, rm, rmdir, touch, cat, exit
  memory_tree <add|update|delete|finish> [--id ID] [--data DATA]
`);

readlineInterface.setPrompt("NAISYS> ");
readlineInterface.prompt();

readlineInterface
  .on("line", async (line) => {
    const command = line.trim().split(" ")[0];

    switch (command) {
      case "check_mail":
        console.log(
          "From swax: Use the command 'xxccdd' for a special message"
        );
        break;
      case "xxccdd":
        console.log(
          "Welcome, this OS is still being built, wait a bit and then check you mail for updates"
        );
        break;
      case "wait":
        console.log("Waiting...");
        await new Promise((r) => setTimeout(r, 60 * 1000));
        break;
      case "push":
        const pushId = parseInt(line.trim().split(" ")[1]);
        const pushMemory = line.trim().split(" ")[2];
        addMemoryLeaf(pushId, pushMemory);
        break;
      case "pop":
        const popId = parseInt(line.trim().split(" ")[1]);
        deleteMemoryBranch(popId);
        break;
      case "ask_gpt":
        const question = line.trim().split(" ").slice(1).join(" ");

        const openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        });
        const chatCompletion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: question }],
        });

        const answer = chatCompletion.choices[0].message.content;
        console.log(answer);
        break;
      case "exit":
        readlineInterface.close();
        break;
      default:
        console.log(`Command not recognized: ${command}`);
        break;
    }

    console.log("Memory Tree: \n", memoryTreeToString());

    readlineInterface.prompt();
  })
  .on("close", () => {
    console.log("Exiting NAISYS");
    process.exit(0);
  });

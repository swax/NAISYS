import * as readline from "readline";
import dotenv from "dotenv";
import OpenAI from "openai";

// setup
dotenv.config();

if (process.env.OPENAI_API_KEY === undefined) {
  console.log("Error: OPENAI_API_KEY is not defined");
}

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

let cycle = 1;
let previousCycleNotes = "";

const commands = `suggest <note>: Use this command to suggest a command to be implememted for the next cycle
endcycle <note>: Ends this cycle, clears the console log. Add notes to the command to carry over to the next cycle`;

let context = `AISH 1.0
Date: Saturday 1/13/2024 4:53 UTC ${new Date().toUTCString()}
Cycle: ${cycle}
Previous cycle notes: ${previousCycleNotes}
Comamnds:
${commands}\n`;

console.log(context);

let endcycle = false;
while (!endcycle) {
  // get root input - hidden from context
  let rootInput = "...";
  while (rootInput) {
    rootInput = await getInput(`root@$system-01:~# `);

    const rootCommand = rootInput.trim().split(" ")[0];
    if (!rootCommand) continue;

    switch (rootCommand) {
      case "talk":
        const talkMsg = rootInput.trim().split(" ").slice(1).join(" ");
        addToContext(`Broadcast Message from root@system01: ${talkMsg}`);
        break;
      default:
        console.log("Invalid root command");
    }
  }

  // get gpt input
  const gptPrompt = `chatgpt@system-01:~$ `;
  context += gptPrompt;

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "Please enter a valid command",
      },
      { role: "user", content: context },
    ],
  });

  const gptConsoleInput = chatCompletion.choices[0].message.content || "";
  context += gptConsoleInput + "\n";
  console.log(gptPrompt + gptConsoleInput);

  const command = gptConsoleInput.trim().split(" ")[0];

  switch (command) {
    case "suggest":
      addToContext("Suggestion noted. Thank you for your feedback!");
      break;
    case "endcycle":
      endcycle = true;
      break;
    default:
      addToContext(`Invalid command: ${command}`);
  }
}

function addToContext(message: string) {
  context += message + "\n";
  console.log(message);
}
`

chatgpt@system-01:~$ gpt input

gpt output

after command switch to root
swax@system-01:~#

dont send root 

rootcomamnds - set MOTD, manually endcycle, context, etc..
  context prints context that will be sent after root command
  no input on rootcommand will jump right to gpt 
  input into root will give another chance for a root command

then back to chatgpt@system-01:~$`;

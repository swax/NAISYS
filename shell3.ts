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

// file system
interface FileSystemFile {
  name: string;
  parent: FileSystemDirectory;
  content: string;
}

interface FileSystemDirectory {
  name: string;
  parent?: FileSystemDirectory;
  directories: FileSystemDirectory[];
  files?: FileSystemFile[];
}

const rootDirectory: FileSystemDirectory = {
  name: "",
  directories: [],
  files: [],
};

let currentDirectory = rootDirectory;

function getCurrentPath() {
  let path = "";
  let currentDir: FileSystemDirectory | undefined = currentDirectory;
  while (currentDir?.parent) {
    path = currentDir.name + "/" + path;
    currentDir = currentDir.parent;
  }
  return "/" + path;
}

// session
const username = "jill";
let cycle = 1;
let previousSessionNotes = "";
let context = "";

while (true) {
  addToContext(`NAISYS 1.0 Shell
Welcome back ${username}!
MOTD:
  Date: ${new Date().toUTCString()}
  Standard Unix Commands available. 
  Enter one command at a time, or separate multiple commands with a semicolon.
  Special Commands:
    suggest <note>: Suggest something to be implemented for the next cycle
    talk <user> <message>: Use this command to send a message to another user
    endsession <note>: Ends this session, clears the console log. Add notes to carry over to the next session
  Previous session notes: ${previousSessionNotes}`);

  let endcycle = false;
  while (!endcycle) {
    // Get root input - hidden from context
    // Accept root commands until a blank one is entered
    let rootInput = "...";
    while (rootInput) {
      rootInput = await getInput(`\nroot@$system-01:${getCurrentPath()}# `);

      const rootCommand = rootInput.trim().split(" ")[0];
      if (!rootCommand) continue;

      switch (rootCommand) {
        case "talk":
          const talkMsg = rootInput.trim().split(" ").slice(1).join(" ");
          addToContext(`Broadcast Message from root@system01: ${talkMsg}`);
          break;
        case "context":
          console.log("~~~~~~~~~~~~~~~~~~~~~`");
          console.log(context);
          console.log("~~~~~~~~~~~~~~~~~~~~~`");
          break;
        default:
          console.log("Invalid root command");
      }
    }
    console.log("");

    // get gpt input
    const gptPrompt = `${username}@system-01:${getCurrentPath()}$ `;
    context += gptPrompt;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4", //"gpt-3.5-turbo", //
      messages: [
        {
          role: "system",
          content: `You are ${username} a new hire with the job of creating a news website from the command line. 
            The 'user' is the command line interface itself presenting you with the next command prompt. 
            Make sure the read the command line rules in the MOTD carefully.`,
        },
        { role: "user", content: context },
      ],
    });

    const gptConsoleInput = chatCompletion.choices[0].message.content || "";
    context += gptConsoleInput + "\n";
    console.log(gptPrompt + gptConsoleInput);

    const gptConsoleInputLines = gptConsoleInput.trim().split("\n");

    // iterate lines
    let processNextLine = true;
    while (processNextLine) {
      processNextLine = false;

      const line = gptConsoleInputLines.shift() || "";
      const command = line.trim().split(" ")[0];
      const cmdParams = line.trim().split(" ")[1];

      if (!command) continue;
      
      switch (command) {
        case "suggest":
          addToContext("Suggestion noted. Thank you for your feedback!");
          break;

        case "talk":
          addToContext("Message sent!");
          break;

        case "endsession":
          cycle++;
          previousSessionNotes = gptConsoleInput
            .trim()
            .split(" ")
            .slice(1)
            .join(" ");
          endcycle = true;
          console.log("------------------------------------------------------");
          break;

        case "mkdir":
          const newDirName = cmdParams;
          if (!newDirName) {
            addToContext("Please enter a directory name");
            break;
          }
          currentDirectory.directories.push({
            name: newDirName,
            parent: currentDirectory,
            directories: [],
          });
          addToContext(`Directory ${newDirName} created!`);
          processNextLine = true;
          break;

        case "cd":
          const dirName = cmdParams;
          if (!dirName) {
            addToContext("Please enter a directory name");
            break;
          }
          const newDir = currentDirectory.directories.find(
            (dir) => dir.name === dirName
          );
          if (!newDir) {
            addToContext(`Directory ${dirName} not found`);
            break;
          }
          currentDirectory = newDir;
          addToContext(`Directory changed to ${dirName}`);
          processNextLine = true;
          break;

        case "touch":
          const fileName = cmdParams;
          if (!fileName) {
            addToContext("Please enter a file name");
            break;
          }
          currentDirectory.files?.push({
            name: fileName,
            parent: currentDirectory,
            content: "",
          });
          addToContext(`File ${fileName} created!`);
          processNextLine = true;
          break;

        default:
          addToContext(`Please enter a valid command: '${command}' is unknown`);
      }
    }
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

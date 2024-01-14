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
      const cmdParams = line.trim().split(" ");

      if (!cmdParams[0]) continue;

      switch (cmdParams[0]) {
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
          const newDirName = cmdParams[1];
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
          const dirName = cmdParams[1];
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
          const fileName = cmdParams[1];
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

        case "ls":
          addToContext("Directories: ");
          currentDirectory.directories.forEach((dir) => addToContext(dir.name));
          addToContext("Files: ");
          currentDirectory.files?.forEach((file) => addToContext(file.name));
          break;

        case "echo":
          addToContext(
            "Echo not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file"
          );
          break;

        case "vi":
          addToContext(
            "VI not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file"
          );
          break;

        case "nano":
          addToContext(
            "Nano not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file"
          );
          break;

        case "cat":
          // print out the file
          let filename = cmdParams[1];
          if (!filename) {
            addToContext("Please enter a file name");
            break;
          }

          // write
          if (filename == ">") {
            filename = cmdParams[2];
            if (!filename) {
              addToContext("Please enter a file name");
              break;
            }
            const catWriteFile = currentDirectory.files?.find(
              (file) => file.name === filename
            );
            if (!catWriteFile) {
              addToContext(`File ${filename} not found`);
              break;
            }
            const catWriteFileContent = gptConsoleInputLines.join("\n");
            catWriteFile.content = catWriteFileContent;
            addToContext(`File ${filename} updated!`);
          } else {
            const catFile = currentDirectory.files?.find(
              (file) => file.name === filename
            );
            if (!catFile) {
              addToContext(`File ${filename} not found`);
              break;
            }
            addToContext(catFile.content);
          }
          break;

        default:
          addToContext(
            `Please enter a valid command: '${cmdParams[0]}' is unknown`
          );
      }
    }
  }
}

function addToContext(message: string) {
  context += message + "\n";
  console.log(message);
}

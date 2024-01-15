//import { buildContext } from "./services/contextService.js";
import { init } from "./services/startupService.js";
import * as readline from "readline";
import dotenv from "dotenv";
dotenv.config();


const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

interface StartupParams {
  username: string;
  model: string;
  input: "manual" | "gpt";
}

const startupParams: StartupParams = {
  username: "jill",
  model: "gpt-3.5-turbo",
  input: "manual",
};

const getInput = (query: string) => {
  return new Promise<string>((resolve) => {
    readlineInterface.question(query, (answer) => {
      resolve(answer);
    });
  });
};

init(startupParams.username);

let lastInput = "";

while (true) {
  // clear console
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  const prompt = `${startupParams.username}@vr-news-world:~$ `;

  let context = ""; //buildContext();

  context = prompt + lastInput + "\n" + context;

  if (startupParams.input === "manual") {
    console.log(context);
    lastInput = await getInput(prompt);
  } else {
    context += prompt;

    console.log(context);

    // todo send gpt request
    lastInput = "...Response from gpt...";
  }
}

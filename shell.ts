import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// output welcome
console.log(`Welcome to NAISYS (Node.js Autonomous Intelligence System)
Commands: 
  check_mail: Checks your mail for messages
  xxccdd: Do not use this command yet
  wait: Take a break and wait for a while
  exit: Logout from NAISYS
`);

rl.setPrompt("NAISYS> ");
rl.prompt();

rl.on("line", async (line) => {
  switch (line.trim()) {
    case "check_mail":
      console.log("From swax: Use the command 'xxccdd' for a special message");
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
    case "exit":
      rl.close();
      break;
    default:
      console.log(`Command not recognized: ${line.trim()}`);
      break;
  }
  rl.prompt();
}).on("close", () => {
  console.log("Exiting NAISYS");
  process.exit(0);
});

import { addMemory } from "./memoryListService.js";

export function init(username: string) {
  addMemory(
    "MOTD",
    `VR News World! The latest in Virtual Reality news from across the internet.
Welcome back ${username}!
You have 1 unread email from Jack
Date: ${new Date().toLocaleDateString()}}`
  );

  addMemory(
    "System Users",
    `john: IT Support
jack: Reporter
steve: Proofreader
bob: Business Manager
ashley: HR
jill: Editor`
  );

  addMemory(
    "Shell Commands",
    `ask_gpt <question>: Ask GPT-3 a question
email: Checks your mail for messages
xxccdd: Do not use this command yet
wait: Take a break until a notification wakes you up
suggestion: Suggest a command for adding to the system
unix commands: ls, cd, mkdir, rm, rmdir, touch, cat, exit
memory_tree <add|update|delete|finish> [--id ID] [--data DATA]`
  );

    addMemory(
      "Plan",
      `None`
    );
}

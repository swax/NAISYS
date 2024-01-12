import { addMemory } from "./services/memoryMapService";

addMemory(
  "MOTD",
  `VR News World! The latest in Virtual Reality news from across the internet.
Welcome back Jill, you have 1 new message from Jack`
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
mail: Checks your mail for messages
xxccdd: Do not use this command yet
wait: Take a break until a notification wakes you up
suggestion: Suggest a command for adding to the system
unix commands: ls, cd, mkdir, rm, rmdir, touch, cat, exit
memory_tree <add|update|delete|finish> [--id ID] [--data DATA]`
);

// prompt 
// jill@vr-news-world:~$

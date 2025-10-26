import { program } from "commander";
import { createAgentRuntime } from "./agentRuntime.js";

// Get rid of all of this and do in the main function when all direct config imports are removed
program.argument("<agent-path>", "Path to agent configuration file").parse();

const agent = await createAgentRuntime(program.args[0]);

console.log(`NAISYS STARTED`);

await agent.commandLoop.run();

console.log(`NAISYS TERMINATED`);

process.exit(0);

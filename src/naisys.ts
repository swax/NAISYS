import { program } from "commander";
import { AgentManager } from "./agentManager.js";

console.log(`NAISYS STARTED`);

program.argument("<agent-path>", "Path to agent configuration file").parse();

const agentMaganer = new AgentManager();

await agentMaganer.start(program.args[0]);

await agentMaganer.waitForAllAgentsToComplete();

console.log(`NAISYS EXITED`);

process.exit(0);

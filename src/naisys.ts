import { createAgentRuntime } from "./agentRuntime.js";
import { tempAgentPath } from "./config.js";
import * as output from "./utils/output.js";

const agent = await createAgentRuntime(tempAgentPath);

console.log(`NAISYS STARTED`);

await agent.commandLoop.run();

console.log(`NAISYS TERMINATED`);

process.exit(0);

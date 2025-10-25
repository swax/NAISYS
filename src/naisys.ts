import { createAgentRuntime } from "./agentRuntime.js";
import { tempAgentPath } from "./config.js";
import * as output from "./utils/output.js";

const agent = await createAgentRuntime(tempAgentPath);

await output.commentAndLog(`NAISYS STARTED`);

await agent.commandLoop.run();

await output.commentAndLog(`NAISYS TERMINATED`);

process.exit(0);

import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agentManager.js";
import { createAgentRegistrar } from "./agentRegistrar.js";
import { createGlobalConfig } from "./globalConfig.js";
import { createDatabaseService } from "./services/dbService.js";

dotenv.config({ quiet: true });

program
  .argument("<agent-path>", "Path to agent configuration file")
  .option("--overlord", "Start Overlord server")
  .parse();

// Todo: Move db service into db package, enabling naisys/overlord to independently initialize and upgrade the db
const globalConfig = await createGlobalConfig();
const dbService = await createDatabaseService(globalConfig);

/**
 * --overlord flag is provided, start Overlord server
 * There should be no dependency between overlord and naissys
 * Sharing the same process space is to save 150 mb of node.js runtime memory on small servers
 */
if (program.opts().overlord) {
  console.log("Starting Overlord server...");
  // Don't import the whole fastify web server module tree unless needed
  const { startServer } = await import("@naisys-overlord/server");
  await startServer("hosted");
}

console.log(`NAISYS STARTED`);

const agentPath = program.args[0];


const agentRegistrar = await createAgentRegistrar(
  globalConfig,
  dbService,
  agentPath,
);
const agentManager = new AgentManager(dbService, globalConfig, agentRegistrar);

// Inits the naisys db if it doesn't exist which is needed by overlord
await agentManager.startAgent(agentPath);

await agentManager.waitForAllAgentsToComplete();

console.log(`NAISYS EXITED`);

process.exit(0);

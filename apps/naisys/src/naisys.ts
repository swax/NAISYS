import { createDatabaseService } from "@naisys/database";
import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agent/agentManager.js";
import { createAgentRegistrar } from "./agent/agentRegistrar.js";
import { createGlobalConfig } from "./globalConfig.js";
import { createHubManager } from "./hub/hubManager.js";
import { createHostService } from "./services/hostService.js";

dotenv.config({ quiet: true });

program
  .argument("<agent-path>", "Path to agent configuration file")
  .option("--hub", "Start Hub server for NAISYS instances running across machines")
  .option("--supervisor", "Start Supervisor web server")
  .parse();

const globalConfig = await createGlobalConfig();
const dbService = await createDatabaseService(globalConfig.globalConfig().naisysFolder);
const hostService = await createHostService(globalConfig, dbService);

/**
 * --hub flag is provided, start Hub server for NAISYS instances running across machines
 * There should be no dependency between hub and naisys
 * Sharing the same process space is to save memory on small servers
 */
if (program.opts().hub) {
  // Don't import the hub module tree unless needed
  const { startHub } = await import("@naisys/hub");
  await startHub("hosted");
}

/**
 * --supervisor flag is provided, start Supervisor server
 * There should be no dependency between supervisor and naisys
 * Sharing the same process space is to save 150 mb of node.js runtime memory on small servers
 */
if (program.opts().supervisor) {
  // Don't import the whole fastify web server module tree unless needed
  const { startServer } = await import("@naisys-supervisor/server");
  await startServer("hosted");
}

console.log(`NAISYS STARTED`);

const agentPath = program.args[0];


const agentRegistrar = await createAgentRegistrar(
  globalConfig,
  dbService,
  hostService,
  agentPath,
);
const agentManager = new AgentManager(dbService, globalConfig, hostService, agentRegistrar);

// Start hub connections for multi-machine sync
const hubManager = createHubManager(globalConfig, hostService);
await hubManager.start();

// Inits the naisys db if it doesn't exist which is needed by supervisor
await agentManager.startAgent(agentPath);

await agentManager.waitForAllAgentsToComplete();

console.log(`NAISYS EXITED`);

process.exit(0);

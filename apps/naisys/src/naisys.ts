import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agentManager.js";
import { create } from "domain";
import { createDatabaseService } from "./services/dbService.js";

dotenv.config({ quiet: true });

program
  .argument("<agent-path>", "Path to agent configuration file")
  .option("--overlord", "Start Overlord server")
  .parse();

// If --overlord flag is provided, start Overlord server
if (program.opts().overlord) {
  console.log("Starting Overlord server...");
  // Don't import the whole fastify web server module tree unless needed
  const { startServer } = await import("@naisys-overlord/server");
  await startServer("hosted");
}

console.log(`NAISYS STARTED`);

const dbService = await createDatabaseService();
const agentManager = new AgentManager(dbService);

// Inits the naisys db if it doesn't exist which is needed by overlord
await agentManager.startAgent(program.args[0]);

await agentManager.waitForAllAgentsToComplete();

console.log(`NAISYS EXITED`);

process.exit(0);

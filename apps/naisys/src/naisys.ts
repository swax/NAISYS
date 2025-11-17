import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agentManager.js";

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

const agentMaganer = new AgentManager();

// Inits the naisys db if it doesn't exist which is needed by overlord
await agentMaganer.startAgent(program.args[0]);

await agentMaganer.waitForAllAgentsToComplete();

console.log(`NAISYS EXITED`);

process.exit(0);

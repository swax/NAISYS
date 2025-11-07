import { program } from "commander";
import { AgentManager } from "./agentManager.js";

console.log(`NAISYS STARTED`);

program
  .argument("<agent-path>", "Path to agent configuration file")
  .option("--overlord", "Start Overlord server")
  .parse();

const agentMaganer = new AgentManager();

// Inits the naisys db if it doesn't exist which is neede by overlord
await agentMaganer.startAgent(program.args[0]);

// If --overlord flag is provided, start Overlord server
if (program.opts().overlord) {
  console.log("Starting Overlord server...");
  // Dynamic import ensures env vars are loaded before overlord modules load
  const { startServer } = await import("@naisys-overlord/server");
  await startServer("logToFile");
}

await agentMaganer.waitForAllAgentsToComplete();

console.log(`NAISYS EXITED`);

process.exit(0);

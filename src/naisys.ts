import { program } from "commander";
import * as llmail from "./apps/llmail.js";
import * as commandLoop from "./commandLoop.js";
import * as config from "./config.js";
import * as contextLog from "./contextLog.js";

program.argument("<agent-path>", "Path to agent configuration file").parse();

const agentPath = program.args[0];

config.init(agentPath);

await contextLog.init();
await llmail.init();

await commandLoop.run();

process.exit(0);

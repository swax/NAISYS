import * as llmail from "./apps/llmail.js";
import * as commandLoop from "./commandLoop.js";
import * as contextLog from "./contextLog.js";

await contextLog.init();
await llmail.init();

await commandLoop.run();

process.exit(0);

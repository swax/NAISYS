import * as commandLoop from "./command/commandLoop.js";
import * as output from "./utils/output.js";

await output.commentAndLog(`NAISYS STARTED`);

await commandLoop.run();

await output.commentAndLog(`NAISYS TERMINATED`);

process.exit(0);

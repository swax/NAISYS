import dotenv from "dotenv";
import * as llmail from "./apps/llmail.js";
import * as commandLoop from "./commandLoop.js";

dotenv.config();

await llmail.init();

await commandLoop.run();

process.exit(0);

import dotenv from "dotenv";
import * as commandLoop from "./commandLoop.js";

dotenv.config();

await commandLoop.run();

process.exit(0);

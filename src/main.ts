import dotenv from "dotenv";
import * as commandLoopService from "./commandLoopService.js";

dotenv.config();

await commandLoopService.run();

process.exit(0);

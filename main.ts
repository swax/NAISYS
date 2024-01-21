import dotenv from "dotenv";
import * as commandLoopService from "./services/commandLoopService.js";

dotenv.config();

await commandLoopService.run();

process.exit(0);

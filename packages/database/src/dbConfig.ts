import { join } from "path";

const naisysFolder = process.env.NAISYS_FOLDER || "";
export const hubDbPath = join(naisysFolder, "database", "naisys_hub.db");
export const hubDbUrl = "file:" + hubDbPath;

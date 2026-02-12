import { join } from "path";

const naisysFolder = process.env.NAISYS_FOLDER || "";
export const supervisorDbPath = join(naisysFolder, "database", "supervisor.db");
export const supervisorDbUrl = "file:" + supervisorDbPath;

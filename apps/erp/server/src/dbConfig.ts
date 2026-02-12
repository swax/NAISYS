import { join } from "path";

const naisysFolder = process.env.NAISYS_FOLDER || "";
export const erpDbPath = join(naisysFolder, "database", "naisys_erp.db");
export const erpDbUrl = "file:" + erpDbPath;

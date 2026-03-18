import path from "node:path";

import { tailLogFile } from "@naisys/common-node";

export { tailLogFile };

export function getErpLogPath(): string {
  const naisysFolder = process.env.NAISYS_FOLDER;
  if (!naisysFolder) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }
  return path.join(naisysFolder, "logs", "erp.log");
}

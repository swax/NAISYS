import path from "node:path";

import { tailLogFile } from "@naisys/common-node";
import type { ServerLogFile } from "@naisys/supervisor-shared";

export { tailLogFile };

export function getLogFilePath(fileKey: ServerLogFile): string {
  const naisysFolder = process.env.NAISYS_FOLDER;
  if (!naisysFolder) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }
  return path.join(naisysFolder, "logs", `${fileKey}.log`);
}

import { createPrismaClient } from "@naisys/hub-database";
import path from "path";
import { env } from "process";

export function getNaisysDatabasePath(): string {
  if (!env.NAISYS_FOLDER) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }

  const dbFilename = "naisys_hub.db";
  return path.join(env.NAISYS_FOLDER, "database", dbFilename);
}

export const hubDb = createPrismaClient(getNaisysDatabasePath());

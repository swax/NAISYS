import { createPrismaClient, PrismaClient } from "@naisys/database";
import path from "path";
import { env } from "process";

export type MonitorDbType = "monitor-naisys" | "monitor-hub";

let configuredDbType: MonitorDbType | null = null;

export function initMonitorDatabase(dbType: MonitorDbType): void {
  if (prismaClient) {
    throw new Error("Cannot change database type after client is initialized");
  }
  configuredDbType = dbType;
}

function getNaisysDatabasePath(): string {
  if (!env.NAISYS_FOLDER) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }

  if (!configuredDbType) {
    throw new Error(
      "Database type not configured. Call initMonitorDatabase() first.",
    );
  }

  const dbFilename =
    configuredDbType === "monitor-hub" ? "hub.sqlite" : "naisys.sqlite";
  return path.join(env.NAISYS_FOLDER, "database", dbFilename);
}

// Create a singleton Prisma client for the Naisys database
let prismaClient: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    const databasePath = getNaisysDatabasePath();
    prismaClient = createPrismaClient(databasePath);
  }
  return prismaClient;
}

/**
 * Execute a function with access to the Naisys Prisma client
 */
export async function usingNaisysDb<T>(
  run: (prisma: PrismaClient) => Promise<T>,
): Promise<T> {
  const prisma = getPrismaClient();
  return await run(prisma);
}

export function getMonitorDbType(): MonitorDbType {
  if (!configuredDbType) {
    throw new Error(
      "Database type not configured. Call initMonitorDatabase() first.",
    );
  }
  return configuredDbType;
}

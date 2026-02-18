import { createPrismaClient, PrismaClient } from "@naisys/database";
import path from "path";
import { env } from "process";

export function getNaisysDatabasePath(): string {
  if (!env.NAISYS_FOLDER) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }

  const dbFilename = "naisys_hub.db";
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

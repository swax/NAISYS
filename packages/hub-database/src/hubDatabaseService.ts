import { deployPrismaMigrations } from "@naisys/common-node";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

import { hubDbPath } from "./dbConfig.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

export async function createHubDatabaseService() {
  /** Should match version in schema_version table of latest migration script */
  const HUB_DB_VERSION = 19;

  const dbPath = hubDbPath();

  // Ensure database directory exists
  const databaseDir = dirname(dbPath);
  if (!existsSync(databaseDir)) {
    mkdirSync(databaseDir, { recursive: true });
  }

  const prisma = createPrismaClient(dbPath);

  await runMigrations();

  async function runMigrations(): Promise<void> {
    const currentFilePath = fileURLToPath(import.meta.url);
    const databasePackageDir = dirname(dirname(currentFilePath));

    await deployPrismaMigrations({
      packageDir: databasePackageDir,
      databasePath: dbPath,
      expectedVersion: HUB_DB_VERSION,
    });
  }

  /**
   * Wrapper for database operations with retry logic and exponential backoff.
   * Automatically retries on transient errors like lock timeouts and socket timeouts.
   */
  async function usingHubDatabase<T>(
    run: (hubDb: PrismaClient) => Promise<T>,
    maxRetries: number = 5,
    baseDelayMs: number = 100,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await run(prisma);
      } catch (error: unknown) {
        lastError = error;

        const errorObj = error as { code?: string; message?: string };

        // Check if this is a retryable error
        const isRetryable =
          errorObj?.code === "P1008" || // Socket timeout
          errorObj?.code === "P2034" || // Database is locked
          errorObj?.message?.includes("SQLITE_BUSY") ||
          errorObj?.message?.includes("database is locked") ||
          errorObj?.message?.includes("Socket timeout");

        if (!isRetryable || attempt === maxRetries) {
          throw error; // Not retryable or out of retries
        }

        // Exponential backoff: baseDelay * 2^attempt
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `Database operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms: ${errorObj?.code || errorObj?.message}`,
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError; // Should never reach here, but satisfies TypeScript
  }

  function getSchemaVersion(): number {
    return HUB_DB_VERSION;
  }

  async function disconnect(): Promise<void> {
    await prisma.$disconnect();
  }

  return {
    usingHubDatabase,
    getSchemaVersion,
    disconnect,
  };
}

export type HubDatabaseService = Awaited<
  ReturnType<typeof createHubDatabaseService>
>;

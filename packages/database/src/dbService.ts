import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "./generated/prisma/client.js";
import { deployPrismaMigrations } from "./migrationHelper.js";
import { createPrismaClient } from "./prismaClient.js";

export async function createDatabaseService(naisysFolder: string) {
  /** Should match version in schema_version table of latest migration script */
  const latestDbVersion = 10;

  // Ensure database directory exists
  const databasePath = join(naisysFolder, "database", `naisys_hub.db`);
  const databaseDir = dirname(databasePath);
  if (!existsSync(databaseDir)) {
    mkdirSync(databaseDir, { recursive: true });
  }

  const prisma = createPrismaClient(databasePath);

  await runMigrations();

  async function runMigrations(): Promise<void> {
    // Hub-specific: Version 7 is a breaking change — check before migrating
    if (existsSync(databasePath)) {
      try {
        const row = await prisma.schema_version.findUnique({
          where: { id: 1 },
        });
        if (row && row.version < 7 && latestDbVersion >= 7) {
          throw new Error(
            `Database migration from version ${row.version} to ${latestDbVersion} is a breaking change adding multi-machine support. ` +
              `The existing db must be manually deleted to continue.`,
          );
        }
      } catch (error) {
        const errorObj = error as { code?: string };
        if (errorObj?.code !== "P2021") {
          // P2021 = table does not exist — ignore; anything else re-throw
          throw error;
        }
      }
    }

    const currentFilePath = fileURLToPath(import.meta.url);
    const databasePackageDir = dirname(dirname(currentFilePath));
    const absoluteDbPath = resolve(databasePath).replace(/\\/g, "/");

    await deployPrismaMigrations({
      packageDir: databasePackageDir,
      databasePath,
      expectedVersion: latestDbVersion,
      envOverrides: { HUB_DATABASE_URL: `file:${absoluteDbPath}` },
    });
  }

  /**
   * Wrapper for database operations with retry logic and exponential backoff.
   * Automatically retries on transient errors like lock timeouts and socket timeouts.
   */
  async function usingDatabase<T>(
    run: (prisma: PrismaClient) => Promise<T>,
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
    return latestDbVersion;
  }

  async function disconnect(): Promise<void> {
    await prisma.$disconnect();
  }

  return {
    usingDatabase,
    getSchemaVersion,
    disconnect,
  };
}

export type DatabaseService = Awaited<ReturnType<typeof createDatabaseService>>;

import { exec } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

const execAsync = promisify(exec);

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

  /**
   * How this works is that when the schema updates we increment the latestDbVersion in the config, signalling we need to run migrations.
   * Then we check the schema_version table in the database to see what version the database is at.
   * If the versions don't match then we run "prisma migrate deploy" to update the database schema.
   * This is done to speed startup time by avoiding having to run "prisma migrate deploy" on every agent startup.
   */
  async function runMigrations(): Promise<void> {
    try {
      // Only check version if database file already exists
      if (existsSync(databasePath)) {
        let dbVersion: { version: number } | null = null;
        try {
          dbVersion = await prisma.schema_version.findUnique({
            where: { id: 1 },
          });
        } catch (error) {
          // Table doesn't exist yet - treat as new database needing migration
          const errorObj = error as { code?: string };
          if (errorObj?.code === "P2021") {
            // P2021 = table does not exist, proceed with migration
          } else {
            throw error;
          }
        }

        if (dbVersion && dbVersion.version === latestDbVersion) {
          return;
        }

        // Version 7 is a breaking change - costs table schema changed significantly
        if (dbVersion && dbVersion.version < 7 && latestDbVersion >= 7) {
          throw new Error(
            `Database migration from version ${dbVersion.version} to ${latestDbVersion} is a breaking change adding multi-machine support.` +
              `The existing db must be manually deleted to continue.`,
          );
        }

        // Run migration
        console.log(
          `Migrating database from version ${dbVersion?.version} to ${latestDbVersion}...`,
        );
      } else {
        // New database, run migration
        console.log(
          `Creating new database with schema version ${latestDbVersion}...`,
        );
      }

      // Find the @naisys/database package location (this package)
      const currentFilePath = fileURLToPath(import.meta.url);
      const databasePackageDir = dirname(dirname(currentFilePath));
      const schemaPath = join(databasePackageDir, "prisma", "schema.prisma");

      // Run Prisma migrations from the database package directory
      // Ensure absolute path and use forward slashes for file: URL (required on Windows)
      const absoluteDbPath = resolve(databasePath).replace(/\\/g, "/");
      const { stdout, stderr } = await execAsync(
        `npx prisma migrate deploy --schema="${schemaPath}"`,
        {
          cwd: databasePackageDir,
          env: {
            ...process.env,
            HUB_DATABASE_URL: `file:${absoluteDbPath}`,
          },
        },
      );

      if (stdout) console.log(stdout);
      if (stderr && !stderr.includes("Loaded Prisma config")) {
        console.error(stderr);
      }

      // Update version
      await prisma.schema_version.upsert({
        where: { id: 1 },
        update: {
          version: latestDbVersion,
          updated: new Date().toISOString(),
        },
        create: {
          id: 1,
          version: latestDbVersion,
          updated: new Date().toISOString(),
        },
      });

      console.log("Database migration completed.");
    } catch (error) {
      console.error("Error running migrations:", error);
      throw error;
    }
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

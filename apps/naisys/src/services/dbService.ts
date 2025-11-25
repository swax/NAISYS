import { createPrismaClient, PrismaClient } from "@naisys/database";
import { exec } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import * as pathService from "./pathService.js";
import { NaisysPath } from "./pathService.js";

const execAsync = promisify(exec);

export async function createDatabaseService() {
  /** Should match version in schema_version table of latest migration script */
  const latestDbVersion = 4;

  // Ensure database directory exists
  const naisysFolder = process.env["NAISYS_FOLDER"];
  const dbFilePath = new NaisysPath(`${naisysFolder}/database/naisys.sqlite`);
  pathService.ensureFileDirExists(dbFilePath);

  const databasePath = dbFilePath.toHostPath();
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
        const dbVersion = await prisma.schema_version.findUnique({
          where: { id: 1 },
        });

        if (dbVersion && dbVersion.version === latestDbVersion) {
          return;
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

      // Find the @naisys/database package location
      const databasePackageUrl = import.meta.resolve("@naisys/database");
      const databasePackagePath = fileURLToPath(databasePackageUrl);
      const databasePackageDir = dirname(dirname(databasePackagePath));
      const schemaPath = join(databasePackageDir, "prisma", "schema.prisma");

      // Run Prisma migrations from the database package directory
      const { stdout, stderr } = await execAsync(
        `npx prisma migrate deploy --schema="${schemaPath}"`,
        {
          cwd: databasePackageDir,
          env: {
            ...process.env,
            DATABASE_URL: `file:${databasePath}`,
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

  async function usingDatabase<T>(
    run: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return await run(prisma);
  }

  return {
    usingDatabase,
  };
}

export type DatabaseService = Awaited<ReturnType<typeof createDatabaseService>>;

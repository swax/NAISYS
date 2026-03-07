import { deployPrismaMigrations } from "@naisys/common-node";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

import { hubDbPath } from "./dbConfig.js";
import { createPrismaClient } from "./prismaClient.js";

export async function createHubDatabaseService() {
  /** Should match version in schema_version table of latest migration script */
  const HUB_DB_VERSION = 25;

  const dbPath = hubDbPath();

  // Ensure database directory exists
  const databaseDir = dirname(dbPath);
  if (!existsSync(databaseDir)) {
    mkdirSync(databaseDir, { recursive: true });
  }

  await runMigrations();

  const prisma = await createPrismaClient(dbPath);

  async function runMigrations(): Promise<void> {
    const currentFilePath = fileURLToPath(import.meta.url);
    const databasePackageDir = dirname(dirname(currentFilePath));

    await deployPrismaMigrations({
      packageDir: databasePackageDir,
      databasePath: dbPath,
      expectedVersion: HUB_DB_VERSION,
    });
  }

  function getSchemaVersion(): number {
    return HUB_DB_VERSION;
  }

  async function disconnect(): Promise<void> {
    await prisma.$disconnect();
  }

  return {
    hubDb: prisma,
    getSchemaVersion,
    disconnect,
  };
}

export type HubDatabaseService = Awaited<
  ReturnType<typeof createHubDatabaseService>
>;

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { deployPrismaMigrations } from "@naisys/common/dist/migrationHelper.js";
import { SUPERVISOR_DB_VERSION, supervisorDbPath } from "./dbConfig.js";

const __filename = fileURLToPath(import.meta.url);
const packageDir = join(dirname(__filename), "..");

export async function deploySupervisorMigrations(): Promise<void> {
  await deployPrismaMigrations({
    packageDir,
    databasePath: supervisorDbPath(),
    expectedVersion: SUPERVISOR_DB_VERSION,
  });
}

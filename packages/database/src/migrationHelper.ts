import { exec } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { promisify } from "util";
import Database from "better-sqlite3";

const execAsync = promisify(exec);

/**
 * Shared helper that runs `prisma migrate deploy` with a version-checked fast path.
 * Uses `better-sqlite3` directly (synchronous, no Prisma dependency) for the version check.
 */
export async function deployPrismaMigrations(options: {
  /** Directory containing prisma.config.ts and prisma/ folder */
  packageDir: string;
  /** Absolute path to the .db file */
  databasePath: string;
  /** Skip migrations if DB already at this version */
  expectedVersion: number;
  /** Extra env vars (e.g. HUB_DATABASE_URL) forwarded to `prisma migrate deploy` */
  envOverrides?: Record<string, string>;
}): Promise<void> {
  const { packageDir, databasePath, expectedVersion, envOverrides } = options;

  // Ensure database directory exists
  const databaseDir = dirname(databasePath);
  if (!existsSync(databaseDir)) {
    mkdirSync(databaseDir, { recursive: true });
  }

  let currentVersion: number | undefined;

  // Check version if database file already exists
  if (existsSync(databasePath)) {
    const db = new Database(databasePath);
    try {
      const row = db
        .prepare("SELECT version FROM schema_version WHERE id = 1")
        .get() as { version: number } | undefined;
      currentVersion = row?.version;
    } catch {
      // "no such table" → treat as new DB, proceed with migration
    }
    db.close();

    if (currentVersion === expectedVersion) {
      return; // Fast path — already at expected version
    }
  }

  // Log migration status
  if (currentVersion !== undefined) {
    console.log(
      `Migrating database from version ${currentVersion} to ${expectedVersion}...`,
    );
  } else {
    console.log(
      `Creating new database with schema version ${expectedVersion}...`,
    );
  }

  // Run prisma migrate deploy
  const schemaPath = join(packageDir, "prisma", "schema.prisma");
  const absoluteDbPath = resolve(databasePath).replace(/\\/g, "/");
  const { stdout, stderr } = await execAsync(
    `npx prisma migrate deploy --schema="${schemaPath}"`,
    {
      cwd: packageDir,
      env: {
        ...process.env,
        ...envOverrides,
      },
    },
  );

  if (stdout) console.log(stdout);
  if (stderr && !stderr.includes("Loaded Prisma config")) {
    console.error(stderr);
  }

  // Upsert schema_version row via raw SQL
  const db = new Database(absoluteDbPath);
  try {
    db.prepare(
      "INSERT OR REPLACE INTO schema_version (id, version, updated) VALUES (1, ?, ?)",
    ).run(expectedVersion, new Date().toISOString());
  } finally {
    db.close();
  }

  console.log("Database migration completed.");
}

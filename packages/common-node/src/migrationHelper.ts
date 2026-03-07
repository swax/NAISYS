import Database from "better-sqlite3";
import { exec } from "child_process";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { promisify } from "util";

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
  /** Extra env vars forwarded to `prisma migrate deploy` */
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

    // Switch from WAL to DELETE journal mode before closing. This merges any
    // pending WAL data and removes the -wal/-shm files entirely. Without this,
    // prisma migrate (a separate process) sees the leftover SHM file and fails
    // with "database is locked".
    try {
      db.pragma("journal_mode=DELETE");
    } catch {
      // Failed — another process may genuinely hold the lock
    }

    db.close();

    if (currentVersion === expectedVersion) {
      return; // Fast path — already at expected version
    }
  }

  // Log migration status
  if (currentVersion !== undefined) {
    if (currentVersion > expectedVersion) {
      throw new Error(
        `Database version ${currentVersion} is newer than expected ${expectedVersion}. Manual intervention required.`,
      );
    }

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
  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await execAsync(
      `npx prisma migrate deploy --schema="${schemaPath}"`,
      {
        cwd: packageDir,
        env: {
          ...process.env,
          // Resolve to absolute so prisma.config.ts gets a correct path
          // regardless of this subprocess's cwd (which is packageDir)
          NAISYS_FOLDER: resolve(process.env.NAISYS_FOLDER || ""),
          ...envOverrides,
        },
      },
    ));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("database is locked")) {
      // Stale WAL/SHM files from a crashed process — remove and retry
      const walPath = absoluteDbPath + "-wal";
      const shmPath = absoluteDbPath + "-shm";
      let removed = false;
      for (const staleFile of [walPath, shmPath]) {
        if (existsSync(staleFile)) {
          console.log(`Removing stale file: ${staleFile}`);
          unlinkSync(staleFile);
          removed = true;
        }
      }
      if (removed) {
        console.log("Retrying migration after removing stale WAL files...");
        ({ stdout, stderr } = await execAsync(
          `npx prisma migrate deploy --schema="${schemaPath}"`,
          {
            cwd: packageDir,
            env: {
              ...process.env,
              NAISYS_FOLDER: resolve(process.env.NAISYS_FOLDER || ""),
              ...envOverrides,
            },
          },
        ));
      } else {
        throw new Error(
          `Database is locked: ${absoluteDbPath}\n` +
            `Another process may be using the database.`,
        );
      }
    } else {
      throw error;
    }
  }

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

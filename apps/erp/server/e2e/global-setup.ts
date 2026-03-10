import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, "..");
const testNaisysFolder = path.join(serverDir, ".test-naisys");
const testDbPath = path.join(testNaisysFolder, "database", "naisys_erp.db");

// Pre-computed bcrypt hash of "testpass123"
const TEST_PASSWORD_HASH =
  "$2b$10$DOzzf1/f.I5B5Ypm8xdSxuC3/moOATlBcon06nMx1EqIBzT9iP31W";

// Create enough users so each parallel worker gets its own
const TEST_USER_COUNT = 10;

/**
 * Poll until the server's deployPrismaMigrations has created and migrated the
 * database. Playwright starts the webServer before globalSetup, so the file
 * may not exist yet. Returns an open connection for immediate reuse.
 */
function waitForDatabase(timeoutMs = 30_000): Database.Database {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(testDbPath)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      continue;
    }
    try {
      const db = new Database(testDbPath, { timeout: 10_000 });
      db.prepare("SELECT 1 FROM users LIMIT 1").get();
      return db;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  throw new Error(`Timed out waiting for database at ${testDbPath}`);
}

export default function globalSetup() {
  // Ensure the database directory exists so the server can create the file
  mkdirSync(path.dirname(testDbPath), { recursive: true });

  // Wait for the server's deployPrismaMigrations to finish
  const db = waitForDatabase();

  // Wipe all data tables (disable FKs so order doesn't matter)
  db.pragma("foreign_keys = OFF");
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_prisma%' AND name != 'sqlite_sequence' AND name != 'schema_version'",
    )
    .all() as { name: string }[];
  for (const { name } of tables) {
    db.exec(`DELETE FROM "${name}"`);
  }
  db.pragma("foreign_keys = ON");

  // Seed test users (one per parallel worker)
  const insertUser = db.prepare(
    `INSERT INTO users (uuid, username, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
  );
  const insertPerm = db.prepare(
    `INSERT INTO user_permissions (user_id, permission, granted_at)
     VALUES (?, ?, datetime('now'))`,
  );
  const permissions = ["erp_admin", "manage_orders", "manage_runs", "view_all"];
  for (let i = 0; i < TEST_USER_COUNT; i++) {
    const uuid = `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    const result = insertUser.run(uuid, `e2e-test-${i}`, TEST_PASSWORD_HASH);
    const userId = result.lastInsertRowid;
    for (const perm of permissions) {
      insertPerm.run(userId, perm);
    }
  }
  db.close();
}

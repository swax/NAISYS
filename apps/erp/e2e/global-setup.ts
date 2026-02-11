import { execSync } from "child_process";
import path from "path";
import Database from "better-sqlite3";

const serverDir = path.join(__dirname, "../server");
const testDbPath = path.join(serverDir, "prisma/test.db");

// Pre-computed bcrypt hash of "testpass123"
const TEST_PASSWORD_HASH =
  "$2b$10$DOzzf1/f.I5B5Ypm8xdSxuC3/moOATlBcon06nMx1EqIBzT9iP31W";

// Create enough users so each parallel worker gets its own
const TEST_USER_COUNT = 10;

export default function globalSetup() {
  // Push schema to create/reset tables (--force-reset handles the reset
  // without deleting the file, so a reused server's open connection stays valid)
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: serverDir,
    env: {
      ...process.env,
      ERP_DATABASE_URL: `file:${testDbPath}`,
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "sure",
    },
    stdio: "inherit",
  });

  // Seed test users (one per worker) with real bcrypt password hash
  const db = new Database(testDbPath);
  for (let i = 0; i < TEST_USER_COUNT; i++) {
    const uuid = `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    db.exec(`
      INSERT INTO users (uuid, username, password_hash, title, created_at, updated_at)
      VALUES ('${uuid}', 'e2e-test-${i}', '${TEST_PASSWORD_HASH}', 'E2E Test User ${i}', datetime('now'), datetime('now'));
    `);
  }
  db.close();
}

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const serverDir = path.join(__dirname, "../server");
const testDbPath = path.join(serverDir, "prisma/test.db");

export default function globalSetup() {
  // Remove existing test DB for a clean slate
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = testDbPath + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  // Push schema to create tables
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: serverDir,
    env: {
      ...process.env,
      ERP_DATABASE_URL: `file:${testDbPath}`,
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "sure",
    },
    stdio: "inherit",
  });

  // Seed test user
  const db = new Database(testDbPath);
  db.exec(`
    INSERT INTO users (uuid, username, password_hash, title, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000001', 'e2e-test', '$2b$10$placeholder', 'E2E Test User', datetime('now'), datetime('now'));
  `);
  db.close();
}

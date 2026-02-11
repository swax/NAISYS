import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import "dotenv/config";
import { join } from "path";
import { createInterface } from "readline/promises";

const naisysFolder = process.env.NAISYS_FOLDER || "";
const dbPath =
  process.env.ERP_DATABASE_URL?.replace("file:", "") ||
  join(naisysFolder, "database", "naisys_erp.db");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Enter admin password: ");
rl.close();

if (!password) {
  console.error("Password cannot be empty.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);

console.log(`Opening database at ${dbPath} to seed admin user...`);
const db = new Database(dbPath);

const existing = db
  .prepare("SELECT id FROM users WHERE username = 'admin'")
  .get();

if (existing) {
  db.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE username = 'admin'",
  ).run(hash);
  console.log("Updated admin password.");
} else {
  db.prepare(
    "INSERT INTO users (uuid, username, password_hash, title, created_at, updated_at) VALUES (?, 'admin', ?, 'Admin User', datetime('now'), datetime('now'))",
  ).run(randomUUID(), hash);
  console.log("Created admin user.");
}

db.close();
process.exit(0);

import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { createInterface } from "readline/promises";
import {
  initSupervisorDatabase,
  runOnSupervisorDb,
  selectFromSupervisorDb,
} from "./database/supervisorDatabase.js";

dotenv.config({ quiet: true });

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Enter admin password: ");
rl.close();

if (!password) {
  console.error("Password cannot be empty.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);

const dbPath = `${process.env.NAISYS_FOLDER}/database/supervisor.db`;
console.log(`Opening database at ${dbPath} to seed admin user...`);

await initSupervisorDatabase();

const existing = await selectFromSupervisorDb<{ id: number }[]>(
  "SELECT id FROM users WHERE username = 'admin'",
);

if (existing && existing.length > 0) {
  await runOnSupervisorDb(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE username = 'admin'",
    [hash],
  );
  console.log("Updated admin password.");
} else {
  await runOnSupervisorDb(
    "INSERT INTO users (username, password_hash) VALUES ('admin', ?)",
    [hash],
  );
  console.log("Created admin user.");
}

process.exit(0);

import sqlite3 from "sqlite3";
import {
  DatabaseConfig,
  initializeDatabase,
  runOnDb,
  selectFromDb,
} from "./databaseService.js";

const createSessionTable = `
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    start_date TEXT NOT NULL,
    expire_date TEXT NOT NULL
  )
`;

/** In a multiple user setup, settings json would be system wide, but read status would be per user */
const createSettingsTable = `
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settings_json TEXT NOT NULL,
    modify_date TEXT NOT NULL,
    read_status_json TEXT DEFAULT '{}'
  )
`;

function getOverlordConfig(): DatabaseConfig {
  const dbPath = process.env.OVERLORD_DB_PATH || "./overlord.db";

  return {
    dbPath,
    validatePath: false, // Overlord creates the DB if it doesn't exist
    initSql: [
      createSessionTable,
      createSettingsTable,
      "PRAGMA journal_mode = WAL",
    ],
  };
}

// Initialize the database on module load
const config = getOverlordConfig();
await initializeDatabase(config);

export async function selectFromOverlordDb<T>(
  sql: string,
  params: any[] = [],
): Promise<T> {
  return selectFromDb<T>(config, sql, params);
}

export async function runOnOverlordDb(
  sql: string,
  params: any[] = [],
): Promise<sqlite3.RunResult> {
  return runOnDb(config, sql, params);
}

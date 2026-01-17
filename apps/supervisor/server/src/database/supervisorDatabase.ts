import path from "path";
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

function getSupervisorConfig(): DatabaseConfig {
  if (!process.env.NAISYS_FOLDER) {
    // include the path of the env file
    throw new Error(`NAISYS_FOLDER is not set in environment variables`);
  }

  const dbPath = path.join(process.env.NAISYS_FOLDER, "/database/supervisor.db");

  return {
    dbPath,
    validatePath: false, // Supervisor creates the DB if it doesn't exist
    initSql: [
      createSessionTable,
      createSettingsTable,
      "PRAGMA journal_mode = WAL",
    ],
  };
}

let config: DatabaseConfig;

export async function initSupervisorDatabase() {
  // Initialize the database on module load
  config = getSupervisorConfig();
  await initializeDatabase(config);
}

export async function selectFromSupervisorDb<T>(
  sql: string,
  params: any[] = [],
): Promise<T> {
  return selectFromDb<T>(config, sql, params);
}

export async function runOnSupervisorDb(
  sql: string,
  params: any[] = [],
): Promise<sqlite3.RunResult> {
  return runOnDb(config, sql, params);
}

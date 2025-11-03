import path from "path";
import { env } from "process";
import sqlite3 from "sqlite3";
import { DatabaseConfig, runOnDb, selectFromDb } from "./databaseService.js";

function getNaisysConfig(): DatabaseConfig {
  if (!env.NAISYS_FOLDER) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }

  const dbPath = path.join(env.NAISYS_FOLDER, "database", "naisys.sqlite");

  return {
    dbPath,
    validatePath: true, // Naisys requires the DB to already exist
  };
}

export async function selectFromNaisysDb<T>(
  sql: string,
  params: any[] = [],
): Promise<T> {
  const config = getNaisysConfig();
  return selectFromDb<T>(config, sql, params);
}

export async function runOnNaisysDb(
  sql: string,
  params: any[] = [],
): Promise<sqlite3.RunResult> {
  const config = getNaisysConfig();
  return runOnDb(config, sql, params);
}

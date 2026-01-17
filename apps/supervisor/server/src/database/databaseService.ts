import * as fs from "fs";
import sqlite3 from "sqlite3";

sqlite3.verbose();

export interface DatabaseConfig {
  dbPath: string;
  validatePath?: boolean;
  initSql?: string[];
}

// Function overloads for type safety
async function executeOnDb(
  config: DatabaseConfig,
  sql: string,
  params: any[],
  method: "run",
): Promise<sqlite3.RunResult>;
async function executeOnDb<T>(
  config: DatabaseConfig,
  sql: string,
  params: any[],
  method: "all",
): Promise<T>;
async function executeOnDb<T>(
  config: DatabaseConfig,
  sql: string,
  params: any[] = [],
  method: "all" | "run",
): Promise<T | sqlite3.RunResult> {
  // Validate database path if required
  if (config.validatePath) {
    const dbExists = fs.existsSync(config.dbPath);
    if (!dbExists) {
      throw new Error(`Database file does not exist at path: ${config.dbPath}`);
    }
  }

  const db = new sqlite3.Database(config.dbPath);

  // Configure database
  if (method === "run") {
    db.run("PRAGMA foreign_keys = ON");
  }

  return new Promise((resolve, reject) => {
    if (method === "all") {
      db.all(sql, params, (err: Error | null, result: any) => {
        db.close();
        if (err) {
          reject(err);
        } else {
          resolve(result as T);
        }
      });
    } else {
      // For db.run(), the result info is on the 'this' context, not as a parameter
      db.run(
        sql,
        params,
        function (this: sqlite3.RunResult, err: Error | null) {
          db.close();
          if (err) {
            reject(err);
          } else {
            // 'this' contains lastID, changes, etc.
            resolve(this as sqlite3.RunResult as T | sqlite3.RunResult);
          }
        },
      );
    }
  });
}

export async function selectFromDb<T>(
  config: DatabaseConfig,
  sql: string,
  params: any[] = [],
): Promise<T> {
  return executeOnDb<T>(config, sql, params, "all");
}

export async function runOnDb(
  config: DatabaseConfig,
  sql: string,
  params: any[] = [],
): Promise<sqlite3.RunResult> {
  return executeOnDb(config, sql, params, "run");
}

export async function initializeDatabase(
  config: DatabaseConfig,
): Promise<void> {
  if (config.initSql && config.initSql.length > 0) {
    for (const sql of config.initSql) {
      await runOnDb(config, sql);
    }
  }
}

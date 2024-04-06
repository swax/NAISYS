import * as fs from "fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import * as pathService from "./pathService.js";
import { NaisysPath } from "./pathService.js";

export async function initDatabase(filepath: NaisysPath) {
  const hostPath = filepath.toHostPath();

  if (fs.existsSync(hostPath)) {
    return false;
  }

  pathService.ensureFileDirExists(filepath);

  const db = await open({
    filename: hostPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  });

  await db.close();

  return true;
}

export async function openDatabase(filepath: NaisysPath): Promise<Database> {
  const hostPath = filepath.toHostPath();

  const db = await open({
    filename: hostPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE,
  });

  // Turn foreign key constraints on
  await db.exec("PRAGMA foreign_keys = ON");

  return db;
}

export async function usingDatabase<T>(
  filepath: NaisysPath,
  run: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await openDatabase(filepath);

  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

import * as fs from "fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { ensureFileDirExists } from "./utilities.js";

export async function initDatabase(filepath: string) {
  if (fs.existsSync(filepath)) {
    return false;
  }

  ensureFileDirExists(filepath);

  const db = await open({
    filename: filepath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  });

  await db.close();

  return true;
}

export async function openDatabase(filepath: string): Promise<Database> {
  const db = await open({
    filename: filepath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE,
  });

  // Turn foreign key constraints on
  await db.exec("PRAGMA foreign_keys = ON");

  return db;
}

export async function usingDatabase<T>(
  filepath: string,
  run: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await openDatabase(filepath);

  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

import * as fs from "fs";
import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";

export async function initDatabase(path: string) {
  if (fs.existsSync(path)) {
    return false;
  }

  const dbDir = path.split("/").slice(0, -1).join("/");

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = await open({
    filename: path,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  });

  await db.close();

  return true;
}

export async function openDatabase(path: string): Promise<Database> {
  const db = await open({
    filename: path,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE,
  });

  // Turn foreign key constraints on
  await db.exec("PRAGMA foreign_keys = ON");

  return db;
}

export async function usingDatabase<T>(
  path: string,
  run: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await openDatabase(path);

  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

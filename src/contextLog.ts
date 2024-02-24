import { Database } from "sqlite";
import * as config from "./config.js";
import * as dbUtils from "./dbUtils.js";
import { naisysToHostPath } from "./utilities.js";

export enum LlmRole {
  Assistant = "assistant",
  User = "user",
  /** Not supported by Google API */
  System = "system",
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  logId?: number;
}

const _dbFilePath = naisysToHostPath(`${config.rootFolder}/var/naisys/log.db`);

export async function init() {
  const dbCreated = await dbUtils.initDatabase(_dbFilePath);

  await usingDatabase(async (db) => {
    if (dbCreated) {
      const createTables = [
        `CREATE TABLE ContextLog (
          id INTEGER PRIMARY KEY, 
          role TEXT NOT NULL,
          message TEXT NOT NULL,
          date TEXT NOT NULL
      )`,
      ];

      for (const createTable of createTables) {
        await db.exec(createTable);
      }
    }
  });
}

export async function add(message: LlmMessage) {
  await usingDatabase(async (db) => {
    const inserted = await db.run(
      "INSERT INTO ContextLog (role, message, date) VALUES (?, ?, ?)",
      message.role,
      message.content,
      new Date().toISOString(),
    );

    message.logId = inserted.lastID;
  });

  // Write to file: date, user, role, message
}

export async function update(message: LlmMessage) {
  await usingDatabase(async (db) => {
    await db.run(
      "UPDATE ContextLog SET message = ? WHERE id = ?",
      message.content,
      message.logId,
    );
  });
}

async function usingDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return dbUtils.usingDatabase(_dbFilePath, run);
}

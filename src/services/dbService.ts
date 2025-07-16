import * as fs from "fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import * as config from "../config.js";
import * as pathService from "./pathService.js";
import { NaisysPath } from "./pathService.js";

export let myUserId = -1;

export async function initDatabase(filepath: NaisysPath) {
  pathService.ensureFileDirExists(filepath);

  const hostPath = filepath.toHostPath();

  await createDatabase(hostPath);

  await usingDatabase(async (db) => {
    // If user is not in the db, add them
    const user = await db.get("SELECT * FROM Users WHERE username = ?", [
      config.agent.username,
    ]);

    // If user not in database, add them
    if (!user) {
      try {
        const insertedUser = await db.run(
          "INSERT INTO Users (username, title, agentPath, leadUsername) VALUES (?, ?, ?, ?)",
          [
            config.agent.username,
            config.agent.title,
            config.agent.hostpath,
            config.agent.leadAgent,
          ],
        );

        if (!insertedUser.lastID) {
          throw "Error adding local user to llmail database";
        }

        myUserId = insertedUser.lastID;
      } catch (e) {
        throw (
          `A user already exists in the database with the agent path (${config.agent.hostpath})\n` +
          `Either create a new agent config file, or delete the ${config.naisysFolder} folder to reset the database.`
        );
      }
    }
    // Else already exists, validate it's config path is correct
    else {
      myUserId = user.id;

      if (user.agentPath != config.agent.hostpath) {
        throw `Error: User ${config.agent.username} already exists in the database with a different config path (${user.agentPath})`;
      }

      if (
        config.agent.leadAgent &&
        config.agent.leadAgent != user.leadUsername
      ) {
        throw `Error: User ${config.agent.username} already exists in the database with a different lead agent (${user.leadUsername})`;
      }

      // Update user title in database
      if (user.title !== config.agent.title) {
        await db.run("UPDATE Users SET title = ? WHERE id = ?", [
          config.agent.title,
          myUserId,
        ]);
      }
    }
  });

  // Start the lastActive updater after user is initialized
  updateLastActive();
  setInterval(updateLastActive, 2000);
}

async function createDatabase(hostPath: string) {
  const db = await open({
    filename: hostPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  });

  await db.close();

  await usingDatabase(async (db) => {
    const createTables = [
      createUserTable,
      createCostsTable,
      createContextLogTable,
      createDreamLogTable,
      createThreadsTable,
      createThreadMembersTable,
      createThreadMessagesTable,
    ];

    for (const createTable of createTables) {
      await db.exec(createTable);
    }

    // Create indexes for monitoring queries
    const createIndexes = [
      createContextLogIndexes,
      createDreamLogIndexes,
      createCostsIndexes,
      createThreadsIndexes,
      createThreadMessagesIndexes,
      createThreadMembersIndexes,
    ];

    for (const createIndex of createIndexes) {
      await db.exec(createIndex);
    }
  });
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

  // Enable WAL mode for better concurrency
  await db.exec("PRAGMA journal_mode = WAL");

  return db;
}

export async function updateLastActive(): Promise<void> {
  if (myUserId === -1) return;

  try {
    await usingDatabase(async (db) => {
      await db.run("UPDATE Users SET lastActive = ? WHERE id = ?", [
        new Date().toISOString(),
        myUserId,
      ]);
    });
  } catch (error) {
    console.error("Error updating lastActive:", error);
  }
}

export async function usingDatabase<T>(
  run: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await openDatabase(config.dbFilePath);

  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

export const createUserTable = `CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY, 
    username TEXT NOT NULL,
    title TEXT NOT NULL,
    agentPath TEXT NOT NULL,
    leadUsername TEXT,
    lastActive TEXT DEFAULT '',
    UNIQUE(username),
    UNIQUE(agentPath)
  )`;

export const createThreadsTable = `CREATE TABLE IF NOT EXISTS Threads (
    id INTEGER PRIMARY KEY, 
    subject TEXT NOT NULL,
    tokenCount INTEGER NOT NULL DEFAULT 0
  )`;

export const createThreadMembersTable = `CREATE TABLE IF NOT EXISTS ThreadMembers (
    id INTEGER PRIMARY KEY, 
    threadId INTEGER NOT NULL, 
    userId INTEGER NOT NULL,
    newMsgId INTEGER NOT NULL DEFAULT -1,
    archived INTEGER NOT NULL DEFAULT 0,
    UNIQUE(threadId,userId),
    FOREIGN KEY(threadId) REFERENCES Threads(id),
    FOREIGN KEY(userId) REFERENCES Users(id)
  )`;

export const createThreadMessagesTable = `CREATE TABLE IF NOT EXISTS ThreadMessages (
    id INTEGER PRIMARY KEY, 
    threadId INTEGER NOT NULL, 
    userId INTEGER NOT NULL, 
    message TEXT NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY(threadId) REFERENCES Threads(id),
    FOREIGN KEY(userId) REFERENCES Users(id)
  )`;

export const createCostsTable = `CREATE TABLE IF NOT EXISTS Costs (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL, 
    username TEXT NOT NULL,
    subagent TEXT,
    source TEXT NOT NULL,
    model TEXT NOT NULL,
    cost REAL DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0
  )`;

export const createDreamLogTable = `CREATE TABLE IF NOT EXISTS DreamLog (
    id INTEGER PRIMARY KEY, 
    username TEXT NOT NULL,
    date TEXT NOT NULL,
    dream TEXT NOT NULL
  )`;

export const createContextLogTable = `CREATE TABLE IF NOT EXISTS ContextLog (
    id INTEGER PRIMARY KEY, 
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    date TEXT NOT NULL
  )`;

export const createContextLogIndexes = `
  CREATE INDEX IF NOT EXISTS idx_contextlog_id_desc ON ContextLog(id DESC);
`;

export const createDreamLogIndexes = `
  CREATE INDEX IF NOT EXISTS idx_dreamlog_id_desc ON DreamLog(id DESC);
`;

export const createCostsIndexes = `
  CREATE INDEX IF NOT EXISTS idx_costs_id_desc ON Costs(id DESC);
`;

export const createThreadsIndexes = `
  CREATE INDEX IF NOT EXISTS idx_threads_id_desc ON Threads(id DESC);
`;

export const createThreadMessagesIndexes = `
  CREATE INDEX IF NOT EXISTS idx_threadmessages_id_desc ON ThreadMessages(id DESC);
  CREATE INDEX IF NOT EXISTS idx_threadmessages_threadid ON ThreadMessages(threadId);
`;

export const createThreadMembersIndexes = `
  CREATE INDEX IF NOT EXISTS idx_threadmembers_threadid ON ThreadMembers(threadId);
`;

await initDatabase(config.dbFilePath);

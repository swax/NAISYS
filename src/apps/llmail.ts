import * as fs from "fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import table from "text-table";
import * as config from "../config.js";
import * as output from "../output.js";
import { naisysToHostPath } from "../utilities.js";

const _dbFilePath = naisysToHostPath(`${config.rootFolder}/var/llmail.db`);

let _myUserId = -1;

async function openDatabase(create?: boolean): Promise<Database> {
  let mode = sqlite3.OPEN_READWRITE;
  if (create) {
    mode = mode | sqlite3.OPEN_CREATE;
  }

  const db = await open({
    filename: _dbFilePath,
    driver: sqlite3.Database,
    mode,
  });

  // turn foreign key constraints on
  await db.exec("PRAGMA foreign_keys = ON");

  return db;
}

async function usingDatabase(
  run: (db: Database) => Promise<string>,
  create?: boolean,
): Promise<string> {
  const db = await openDatabase(create);

  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

export async function init() {
  const createDb = !fs.existsSync(_dbFilePath);

  await usingDatabase(async (db) => {
    if (createDb) {
      const createTables = [
        `CREATE TABLE Users (
          id INTEGER PRIMARY KEY, 
          username TEXT NOT NULL
      )`,
        `CREATE TABLE Threads (
          id INTEGER PRIMARY KEY, 
          subject TEXT NOT NULL
      )`,
        `CREATE TABLE ThreadMembers (
          id INTEGER PRIMARY KEY, 
          threadId INTEGER NOT NULL, 
          userId INTEGER NOT NULL,
          newMsg INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
	        UNIQUE(threadId,userId),
          FOREIGN KEY(threadId) REFERENCES Threads(id),
          FOREIGN KEY(userId) REFERENCES Users(id)

      )`,
        `CREATE TABLE ThreadMessages (
          id INTEGER PRIMARY KEY, 
          threadId INTEGER NOT NULL, 
          userId INTEGER NOT NULL, 
          message TEXT NOT NULL,
          date TEXT NOT NULL,
          FOREIGN KEY(threadId) REFERENCES Threads(id),
          FOREIGN KEY(userId) REFERENCES Users(id)
      )`,
      ];

      for (const createTable of createTables) {
        await db.exec(createTable);
      }

      output.comment("llmail database initialized");
    }

    // If user is not in the db, add them
    const user = await db.get("SELECT * FROM Users WHERE username = ?", [
      config.agent.username,
    ]);

    if (!user) {
      const insertedUser = await db.run(
        "INSERT INTO Users (username) VALUES (?)",
        [config.agent.username],
      );

      if (!insertedUser.lastID) {
        throw new Error("Error adding local user to llmail database");
      }

      _myUserId = insertedUser.lastID;

      output.comment(`${config.agent.username} added to llmail database `);
    } else {
      _myUserId = user.id;
    }

    return "";
  }, createDb);
}

export async function run(args: string): Promise<string> {
  const argParams = args.split(" ");

  if (!argParams[0]) {
    return await listThreads();
  }

  switch (argParams[0]) {
    case "help": {
      return `llmail: Local email system
  no params: List all active threads
  users: Get list of users on the system
  send "<users>" "subject" "message": Send a new mail, starting a new thread
  read <id>: Read a thread
  reply <id> <message>: Reply to a thread
  adduser <id> <username>: Add a user to a thread
  archive <id>: Archive a thread
  wait: Wait for new messages (sleep until a a new message arrives)
    `;
    }

    case "send": {
      const newParams = argParams.slice(1).join(" ").split('"');
      const usernames = newParams[1].split(",").map((u) => u.trim());
      const subject = newParams[3];
      const message = newParams[5];

      return await newThread(usernames, subject, message);
    }

    case "read": {
      const threadId = parseInt(argParams[1]);

      return await readThread(threadId);
    }

    case "users": {
      return await listUsers();
    }

    case "reply": {
      const threadId = parseInt(argParams[1]);
      const message = argParams.slice(2).join(" ");

      return await replyThread(threadId, message);
    }

    case "adduser": {
      const threadId = parseInt(argParams[1]);
      const username = argParams[2];
      return await addUser(threadId, username);
    }

    case "archive": {
      const threadId = parseInt(argParams[1]);
      return await archiveThread(threadId);
    }

    // Root level 'secret command'. Don't let the LLM know about this
    case "reset":
      if (fs.existsSync(_dbFilePath)) {
        fs.unlinkSync(_dbFilePath);
      }
      await init();
      return "llmail database reset";
  }

  return "Unknown llmail command: " + argParams[0];
}

export async function getNotifications(): Promise<string> {
  return await usingDatabase(async (db) => {
    const updatedThreads = await db.all(
      `SELECT tm.threadId
        FROM ThreadMembers tm
        WHERE tm.userId = ? AND tm.newMsg = 1 AND tm.archived = 0`,
      [_myUserId],
    );

    if (updatedThreads.length === 0) {
      return "";
    }

    const threadIds = updatedThreads.map((t) => t.threadId).join(", ");

    return `New Messages on Thread ID ${threadIds}: Use 'llmail read <id>' to read the thread`;
  });
}

async function listThreads(): Promise<string> {
  return await usingDatabase(async (db) => {
    const threads = await db.all(
      `SELECT t.id, t.subject, max(msg.date) as date,
      (
            SELECT GROUP_CONCAT(u.username, ', ') 
            FROM ThreadMembers tm 
            JOIN Users u ON tm.userId = u.id
            WHERE tm.threadId = t.id
            GROUP BY tm.threadId
        ) AS members
        FROM Threads t 
        JOIN ThreadMessages msg ON t.id = msg.threadId
        JOIN ThreadMembers member ON t.id = member.threadId
        WHERE member.userId = ? and member.archived = 0
        GROUP BY t.id, t.subject
        ORDER BY max(msg.date)`,
      [_myUserId],
    );

    // Show threads as a table
    return table(
      [
        ["id", "subject", "date", "members"],
        ...threads.map((t) => [t.id, t.subject, t.date, t.members]),
      ],
      { hsep: " | " },
    );
  });
}

async function newThread(
  usernames: string[],
  subject: string,
  message: string,
): Promise<string> {
  // Ensure user ifself is in the list
  if (!usernames.includes(config.agent.username)) {
    usernames.push(config.agent.username);
  }

  return await usingDatabase(async (db) => {
    await db.run("BEGIN TRANSACTION");

    // Create thread
    const thread = await db.run("INSERT INTO Threads (subject) VALUES (?)", [
      subject,
    ]);

    // Add users
    for (const username of usernames) {
      const user = await db.get("SELECT * FROM Users WHERE username = ?", [
        username,
      ]);

      if (user) {
        await db.run(
          "INSERT INTO ThreadMembers (threadId, userId, newMsg) VALUES (?, ?, ?)",
          [thread.lastID, user.id, user.id === _myUserId ? 0 : 1],
        );
      } else {
        await db.run("ROLLBACK");
        throw `User ${username} not found`;
      }
    }

    // Add message
    await db.run(
      "INSERT INTO ThreadMessages (threadId, userId, message, date) VALUES (?, ?, ?, ?)",
      [thread.lastID, _myUserId, message, new Date().toISOString()],
    );

    await db.run("COMMIT");

    return `Thread created with id ${thread.lastID}`;
  });
}

async function readThread(threadId: number): Promise<string> {
  return await usingDatabase(async (db) => {
    const thread = await getThread(db, threadId);

    const threadMembers = await db.all(
      `SELECT u.username
         FROM ThreadMembers tm
         JOIN Users u ON tm.userId = u.id
         WHERE tm.threadId = ?`,
      [threadId],
    );

    let threadMessages = `Thread ID: ${thread.id}
Thread Subject: ${thread.subject}
Thread Members: ${threadMembers.map((m) => m.username).join(", ")}
`;

    const messages = await db.all(
      `SELECT u.username, tm.date, tm.message
         FROM ThreadMessages tm
         JOIN Users u ON tm.userId = u.id
         WHERE tm.threadId = ?
         ORDER BY tm.date`,
      [threadId],
    );

    for (const message of messages) {
      threadMessages += `
From: ${message.username}
Date: ${message.date}
Message: ${message.message}
`;
    }

    // Update thread as read
    await db.run(
      `UPDATE ThreadMembers 
        SET newMsg = 0 
        WHERE threadId = ? AND userId = ?`,
      [threadId, _myUserId],
    );

    return threadMessages;
  });
}

async function listUsers() {
  return await usingDatabase(async (db) => {
    const usersList = await db.all("SELECT * FROM Users");
    return usersList.map((u) => u.username).join(", ");
  });
}

async function replyThread(threadId: number, message: string) {
  return await usingDatabase(async (db) => {
    const thread = await getThread(db, threadId);

    await db.run(
      "INSERT INTO ThreadMessages (threadId, userId, message, date) VALUES (?, ?, ?, ?)",
      [thread.id, _myUserId, message, new Date().toISOString()],
    );

    // Mark thread has new message
    await db.run(
      `UPDATE ThreadMembers 
        SET newMsg = 1 and archived = 0  
        WHERE threadId = ? AND userId != ?`,
      [thread.id, _myUserId],
    );

    return `Message added to thread ${threadId}`;
  });
}

async function addUser(threadId: number, username: string) {
  return await usingDatabase(async (db) => {
    const thread = await getThread(db, threadId);
    const user = await getUser(db, username);

    await db.run(
      "INSERT INTO ThreadMembers (threadId, userId, newMsg) VALUES (?, ?, 1)",
      [thread.id, user.id],
    );

    return `User ${username} added to thread ${threadId}`;
  });
}

async function archiveThread(threadId: number) {
  return await usingDatabase(async (db) => {
    await db.run(
      `UPDATE ThreadMembers 
        SET archived = 1 
        WHERE threadId = ? AND userId = ?`,
      [threadId, _myUserId],
    );

    return `Thread ${threadId} archived`;
  });
}

async function getThread(db: Database, threadId: number) {
  const thread = await db.get(`SELECT * FROM Threads WHERE id = ?`, [threadId]);

  if (!thread) {
    throw `Thread ${threadId} not found`;
  }

  return thread;
}

async function getUser(db: Database, username: string) {
  const user = await db.get(`SELECT * FROM Users WHERE username = ?`, [
    username,
  ]);

  if (!user) {
    throw `User ${username} not found`;
  }

  return user;
}

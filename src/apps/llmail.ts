import * as fs from "fs";
import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import * as config from "../config.js";
import * as output from "../output.js";
import { naisysToHostPath } from "../utilities.js";

// checking mail should probably be done in a 'cycle' where the llm reads, cleans and decides what actions to take

/*
Command:
    users: Get list of users on the system

    llmail: Thead based local email system
        no params: List all threads
        read <id>: Read a thread
        reply <id> "<message>": Reply to a thread
        new "<users>" "subject" "message": Create a new thread
        adduser <id> <username>: Add a user to a thread
        wait: Wait for new messages (basically like endsession, but awake when new messages are received)
    
    Comamnds: inbox, read <id>, reply <id> "<message>", send "<users>" "subject" "message", adduser <id> <username>
    id | date | thread subject | from | to

    On new thread post if user is on the thread
        show in the next prompt that thread has been updated
        use llmail read 123 to see the thread  
        max token length for threads - consolidate or page?

    how to detect new messages
      keep track of the latest message id in the db
      if changed, check if the user is on the thread
      if so, show the thread in the next prompt

    llmail read <id>
    Thread Subject: hello world
    Members: Bob, Jill, Steve, John

    From: Bob
    Date: 2021-08-01 12:00
    Message: 
    Hello Jill, I hope you are doing well. I was thinking about our conversation the other day and 
    I think we should move forward with the plan. Let me know if you have any questions.

    From: Jill
    Date: 2021-08-02 12:00
    Message: 
    Hey Bob, I agree let's do that
*/

const _dbFilePath = naisysToHostPath(`${config.rootFolder}/var/llmail.db`);

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

  const result = await usingDatabase(async (db) => {
    if (createDb) {
      const createTables = [
        `CREATE TABLE Users (
          id INTEGER PRIMARY KEY, 
          username TEXT
      )`,
        `CREATE TABLE Threads (
          id INTEGER PRIMARY KEY, 
          subject TEXT
      )`,
        `CREATE TABLE ThreadMembers (
          id INTEGER PRIMARY KEY, 
          threadId INTEGER, 
          userId INTEGER,
          FOREIGN KEY(threadId) REFERENCES Threads(id),
          FOREIGN KEY(userId) REFERENCES Users(id)
      )`,
        `CREATE TABLE ThreadMessages (
          id INTEGER PRIMARY KEY, 
          threadId INTEGER, 
          userId INTEGER, 
          message TEXT,
          date TEXT,
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
    const users = await db.all("SELECT * FROM Users WHERE username = ?", [
      config.agent.username,
    ]);

    if (users.length == 0) {
      await db.run("INSERT INTO Users (username) VALUES (?)", [
        config.agent.username,
      ]);
    }

    return `${config.agent.username} added to llmail database `;
  }, createDb);

  output.comment(result);
}

export async function run(args: string): Promise<string> {
  const argParams = args.split(" ");

  switch (argParams[0]) {
    case "reset":
      if (fs.existsSync(_dbFilePath)) {
        fs.unlinkSync(_dbFilePath);
      }
      await init();
      return "llmail database reset";

    case "new": {
      const newParams = argParams.slice(1).join(" ").split('"');
      const usernames = newParams[1].split(",").map((u) => u.trim());
      const subject = newParams[3];
      const message = newParams[5];

      return await newThread(usernames, subject, message);
    }
  }

  return "Unknown llmail command";
}

async function newThread(
  usernames: string[],
  subject: string,
  message: string,
): Promise<string> {
  // check if self is in the list
  if (!usernames.includes(config.agent.username)) {
    usernames.push(config.agent.username);
  }

  return await usingDatabase(async (db) => {
    db.run("BEGIN TRANSACTION");

    // Create thread
    const thread = await db.run("INSERT INTO Threads (subject) VALUES (?)", [
      subject,
    ]);

    let myUserId = -1;

    // Add users
    for (const username of usernames) {
      const user = await db.get("SELECT * FROM Users WHERE username = ?", [
        username,
      ]);

      if (user) {
        await db.run(
          "INSERT INTO ThreadMembers (threadId, userId) VALUES (?, ?)",
          [thread.lastID, user.id],
        );

        if (username == config.agent.username) {
          myUserId = user.id;
        }
      } else {
        db.run("ROLLBACK");
        return `Error: User ${username} not found`;
      }
    }

    // Add message
    await db.run(
      "INSERT INTO ThreadMessages (threadId, userId, message, date) VALUES (?, ?, ?, ?)",
      [thread.lastID, myUserId, message, new Date().toISOString()],
    );

    db.run("COMMIT");

    return `Thread created with id ${thread.lastID}`;
  });
}

import * as fs from "fs";
import { open } from "sqlite";
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

export async function init() {
  const createDb = !fs.existsSync(_dbFilePath);

  const db = await open({
    filename: _dbFilePath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  });

  try {
    if (createDb) {
      await db.exec(
        "CREATE TABLE Users (id INTEGER PRIMARY KEY, username TEXT)",
      );
      await db.exec(
        "CREATE TABLE Threads (id INTEGER PRIMARY KEY, subject TEXT)",
      );
      await db.exec(
        "CREATE TABLE ThreadMembers (id INTEGER PRIMARY KEY, threadId INTEGER, userId INTEGER)",
      );
      await db.exec(
        "CREATE TABLE ThreadMessages (id INTEGER PRIMARY KEY, threadId INTEGER, userId INTEGER, message TEXT)",
      );

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

    output.comment(`${config.agent.username} added to llmail database `);
  } finally {
    await db.close();
  }
}

export async function run(args: string) {
  if (args.startsWith("reset")) {
    if (fs.existsSync(_dbFilePath)) {
      fs.unlinkSync(_dbFilePath);
    }

    await init();
  }

  return "Unknown llmail command";
}

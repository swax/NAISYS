import * as fs from "fs";
import { Database } from "sqlite";
import table from "text-table";
import * as config from "../config.js";
import * as dbUtils from "../utils/dbUtils.js";
import { NaisysPath } from "../utils/pathService.js";
import * as utilities from "../utils/utilities.js";

const _dbFilePath = new NaisysPath(`${config.naisysFolder}/lib/llmail.db`);

let _myUserId = -1;

/** Threading is not currently used in `simpleMode` so this doesn't matter */
const _threadTokenMax = config.agent.mailMessageTokenMax
  ? config.agent.mailMessageTokenMax * 5
  : undefined;

/** The 'non-simple' version of this is a thread first mail system. Where agents can create threads, add users, and reply to threads, etc..
 * The problem with this was the agents were too chatty with so many mail commands, wasting context replying, reading threads, etc..
 * Simple mode only has two commands. It still requires db persistance to support offline agents. */
export const simpleMode = true;

await init();

async function init() {
  const newDbCreated = await dbUtils.initDatabase(_dbFilePath);

  await usingDatabase(async (db) => {
    if (newDbCreated) {
      const createTables = [
        `CREATE TABLE Users (
          id INTEGER PRIMARY KEY, 
          username TEXT NOT NULL,
          title TEXT NOT NULL,
          agentPath TEXT NOT NULL,
          leadUsername TEXT,
          UNIQUE(username),
          UNIQUE(agentPath)
      )`,
        `CREATE TABLE Threads (
          id INTEGER PRIMARY KEY, 
          subject TEXT NOT NULL,
          tokenCount INTEGER NOT NULL DEFAULT 0
      )`,
        `CREATE TABLE ThreadMembers (
          id INTEGER PRIMARY KEY, 
          threadId INTEGER NOT NULL, 
          userId INTEGER NOT NULL,
          newMsgId INTEGER NOT NULL DEFAULT -1,
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
    }

    // If user is not in the db, add them
    const user = await db.get("SELECT * FROM Users WHERE username = ?", [
      config.agent.username,
    ]);

    // If user not in database, add them
    if (!user) {
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

      _myUserId = insertedUser.lastID;
    }
    // Else already exists, validate it's config path is correct
    else {
      _myUserId = user.id;

      if (user.agentPath != config.agent.hostpath) {
        throw `Error: User ${config.agent.username} already exists in the database with a different config path (${user.agentPath})`;
      }

      if (
        config.agent.leadAgent &&
        config.agent.leadAgent != user.leadUsername
      ) {
        throw `Error: User ${config.agent.username} already exists in the database with a different lead agent (${user.leadUsername})`;
      }
    }
  });
}

export const waitingForMailMessage = "Waiting for new mail messages...";

export async function handleCommand(args: string): Promise<string> {
  const argParams = args.split(" ");

  if (!argParams[0]) {
    if (simpleMode) {
      argParams[0] = "help";
    } else {
      return await listThreads();
    }
  }

  const tokenMaxNote = config.agent.mailMessageTokenMax
    ? ` ${config.agent.mailMessageTokenMax} token max`
    : "";

  switch (argParams[0]) {
    case "help": {
      if (simpleMode) {
        return `llmail <command>
  users: Get list of users on the system
  send "<users>" "subject" "message": Send a message.${tokenMaxNote}
  wait: Pause the session until a new mail message is received
  
* Attachments are not supported, use file paths to refence files in emails as all users are on the same machine`;
      } else {
        return `llmail <command>
  no params: List all active threads
  users: Get list of users on the system
  send "<users>" "subject" "message": Send a new mail, starting a new thread
  wait: Pause the session until a new mail message is received
  read <id>: Read a thread
  reply <id> <message>: Reply to a thread
  adduser <id> <username>: Add a user to thread with id
  archive <ids>: Archives a comma separated list of threads`;
      }
    }

    case "send": {
      const newParams = argParams.slice(1).join(" ").split('"');

      if (newParams.length < 6) {
        throw "Invalid parameters. There should be a username, subject and message. All contained in quotes.";
      }

      const usernames = newParams[1].split(",").map((u) => u.trim());
      const subject = newParams[3];
      const message = newParams[5];

      return await newThread(usernames, subject, message);
    }

    case "wait": {
      return waitingForMailMessage;
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
      const threadIds = argParams
        .slice(1)
        .join(" ")
        .split(",")
        .map((id) => parseInt(id));

      return await archiveThreads(threadIds);
    }

    // Debug level 'secret command'. Don't let the LLM know about this
    case "reset": {
      const hostPath = _dbFilePath.toHostPath();
      if (fs.existsSync(hostPath)) {
        fs.unlinkSync(hostPath);
      }
      await init();
      return "llmail database reset";
    }

    default:
      return (
        "Error, unknown command. See valid commands below:\n" +
        (await handleCommand("help"))
      );
  }
}

interface UnreadThread {
  threadId: number;
  newMsgId: number;
}
export async function getUnreadThreads(): Promise<UnreadThread[]> {
  return await usingDatabase(async (db) => {
    const updatedThreads = await db.all<UnreadThread[]>(
      `SELECT tm.threadId, tm.newMsgId
        FROM ThreadMembers tm
        WHERE tm.userId = ? AND tm.newMsgId >= 0 AND tm.archived = 0`,
      [_myUserId],
    );

    return updatedThreads;
  });
}

async function listThreads(): Promise<string> {
  return await usingDatabase(async (db) => {
    const threads = await db.all(
      `SELECT t.id, t.subject, max(msg.date) as date, t.tokenCount, 
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
        WHERE member.userId = ? AND member.archived = 0
        GROUP BY t.id, t.subject
        ORDER BY max(msg.date)`,
      [_myUserId],
    );

    // Show threads as a table
    return table(
      [
        ["ID", "Subject", "Date", "Members", "Token Count"],
        ...threads.map((t) => [
          t.id,
          t.subject,
          t.date,
          t.members,
          `${t.tokenCount}/${_threadTokenMax ? _threadTokenMax : "∞"}`,
        ]),
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
  // Ensure user itself is in the list
  if (!usernames.includes(config.agent.username)) {
    usernames.push(config.agent.username);
  }

  message = message.replace(/\\n/g, "\n");

  const msgTokenCount = validateMsgTokenCount(message);

  return await usingDatabase(async (db) => {
    await db.run("BEGIN TRANSACTION");

    // Create thread
    const thread = await db.run(
      "INSERT INTO Threads (subject, tokenCount) VALUES (?, ?)",
      [subject, msgTokenCount],
    );

    // Add users
    for (const username of usernames) {
      const user = await db.get("SELECT * FROM Users WHERE username = ?", [
        username,
      ]);

      if (user) {
        await db.run(
          "INSERT INTO ThreadMembers (threadId, userId, newMsgId) VALUES (?, ?, ?)",
          [thread.lastID, user.id, user.id === _myUserId ? -1 : 0],
        );
      } else {
        await db.run("ROLLBACK");
        throw `Error: User ${username} not found`;
      }
    }

    // Add message
    await db.run(
      "INSERT INTO ThreadMessages (threadId, userId, message, date) VALUES (?, ?, ?, ?)",
      [thread.lastID, _myUserId, message, new Date().toISOString()],
    );

    await db.run("COMMIT");

    return simpleMode ? "Mail sent" : `Thread created with id ${thread.lastID}`;
  });
}

export async function readThread(
  threadId: number,
  newMsgId?: number,
  /** For checking new messages and getting a token count, while not showing the user */
  peek?: boolean,
): Promise<string> {
  return await usingDatabase(async (db) => {
    const thread = await getThread(db, threadId);

    const threadMembers = await db.all(
      `SELECT u.id, u.username
         FROM ThreadMembers tm
         JOIN Users u ON tm.userId = u.id
         WHERE tm.threadId = ?`,
      [threadId],
    );

    let unreadFilter = "";
    if (newMsgId != undefined) {
      unreadFilter = `AND tm.id >= ${newMsgId}`;
    }

    const messages = await db.all(
      `SELECT u.username, tm.date, tm.message
         FROM ThreadMessages tm
         JOIN Users u ON tm.userId = u.id
         WHERE tm.threadId = ? ${unreadFilter}
         ORDER BY tm.date`,
      [threadId],
    );

    let threadMessages = "";

    // If simple mode just show subject/from/to
    // Buildings strings with \n here because otherwise this code is super hard to read
    if (simpleMode) {
      for (const message of messages) {
        const toMembers = threadMembers
          .filter((m) => m.username !== message.username)
          .map((m) => m.username)
          .join(", ");

        threadMessages +=
          `Subject: ${thread.subject}\n` +
          `From: ${message.username}\n` +
          `To: ${toMembers}\n` +
          `Date: ${new Date(message.date).toLocaleString()}\n` +
          `Message:\n` +
          `${message.message}\n`;
      }
    }
    // Else threaded version
    else {
      const toMembers = threadMembers.map((m) => m.username).join(", ");
      threadMessages =
        `Thread ${thread.id}: ${thread.subject}\n` + `Members: ${toMembers}\n`;

      for (const message of messages) {
        threadMessages +=
          `\n` +
          `From: ${message.username}\n` +
          `Date: ${new Date(message.date).toLocaleString()}\n` +
          `Message:\n` +
          `${message.message}\n`;
      }

      threadMessages += `\nUse 'llmail reply ${threadId}' to reply.`;
    }

    if (!peek) {
      await markAsRead(threadId);
    }

    return threadMessages;
  });
}

export async function markAsRead(threadId: number) {
  await usingDatabase(async (db) => {
    await db.run(
      `UPDATE ThreadMembers 
        SET newMsgId = -1 
        WHERE threadId = ? AND userId = ?`,
      [threadId, _myUserId],
    );
  });
}

async function listUsers() {
  return await usingDatabase(async (db) => {
    let userList: {
      username: string;
      title: string;
      extra: string;
      leadUsername?: string;
    }[] = [];

    // If this is a subagent, just allow it to communicate with its lead
    if (config.agent.leadAgent) {
      userList = await db.all(
        "SELECT * FROM Users WHERE  username = ? OR username = ?",
        [config.agent.username, config.agent.leadAgent],
      );

      userList = userList.map((u) => ({
        ...u,
        extra: u.username === config.agent.leadAgent ? "My Lead" : u.extra,
      }));
    }
    // Else return all non-subagent users, except for the ones we are leading
    else {
      userList = await db.all(
        "SELECT * FROM Users WHERE leadUsername IS NULL OR leadUsername = ?",
        [config.agent.username],
      );

      userList = userList.map((u) => ({
        ...u,
        extra: u.leadUsername ? "My Subagent" : u.extra,
      }));
    }

    userList = userList.map((u) => ({
      ...u,
      extra: u.username == config.agent.username ? "Me" : u.extra,
    }));

    return table(
      [
        ["Username", "Title", ""],
        ...userList.map((ul) => [ul.username, ul.title, ul.extra || ""]),
      ],
      { hsep: " | " },
    );
  });
}

export async function getAllUserNames() {
  return await usingDatabase(async (db) => {
    const usersList = await db.all("SELECT username FROM Users");

    return usersList.map((ul) => ul.username);
  });
}

async function replyThread(threadId: number, message: string) {
  message = message.replace(/\\n/g, "\n");

  // Validate message does not exceed token limit
  const msgTokenCount = validateMsgTokenCount(message);

  return await usingDatabase(async (db) => {
    const thread = await getThread(db, threadId);

    const newThreadTokenTotal = thread.tokenCount + msgTokenCount;

    if (_threadTokenMax && newThreadTokenTotal > _threadTokenMax) {
      throw `Error: Reply is ${msgTokenCount} tokens and thread is ${thread.tokenCount} tokens. 
Reply would cause thread to exceed total thread token limit of ${_threadTokenMax} tokens. 
Consider archiving this thread and starting a new one.`;
    }

    const insertedMessage = await db.run(
      "INSERT INTO ThreadMessages (threadId, userId, message, date) VALUES (?, ?, ?, ?)",
      [thread.id, _myUserId, message, new Date().toISOString()],
    );

    // Mark thread has new message only if it hasnt already been marked
    await db.run(
      `UPDATE ThreadMembers 
        SET newMsgId = ?, archived = 0  
        WHERE newMsgId = -1 AND threadId = ? AND userId != ?`,
      [insertedMessage.lastID, thread.id, _myUserId],
    );

    // Update token total
    await db.run(
      `UPDATE Threads 
        SET tokenCount = ? 
        WHERE id = ?`,
      [newThreadTokenTotal, thread.id],
    );

    return `Message added to thread ${threadId}`;
  });
}

async function addUser(threadId: number, username: string) {
  return await usingDatabase(async (db) => {
    const thread = await getThread(db, threadId);
    const user = await getUser(db, username);

    await db.run(
      "INSERT INTO ThreadMembers (threadId, userId, newMsgId) VALUES (?, ?, 0)",
      [thread.id, user.id],
    );

    return `User ${username} added to thread ${threadId}`;
  });
}

async function archiveThreads(threadIds: number[]) {
  return await usingDatabase(async (db) => {
    await db.run(
      `UPDATE ThreadMembers 
        SET archived = 1 
        WHERE threadId IN (${threadIds.join(",")}) AND userId = ?`,
      [_myUserId],
    );

    return `Threads ${threadIds.join(",")} archived`;
  });
}

async function getThread(db: Database, threadId: number) {
  const thread = await db.get(`SELECT * FROM Threads WHERE id = ?`, [threadId]);

  if (!thread) {
    throw `Error: Thread ${threadId} not found`;
  }

  return thread;
}

async function getUser(db: Database, username: string) {
  const user = await db.get(`SELECT * FROM Users WHERE username = ?`, [
    username,
  ]);

  if (!user) {
    throw `Error: User ${username} not found`;
  }

  return user;
}

function validateMsgTokenCount(message: string) {
  const msgTokenCount = utilities.getTokenCount(message);
  const msgTokenMax = config.agent.mailMessageTokenMax;

  if (msgTokenMax && msgTokenCount > msgTokenMax) {
    throw `Error: Message is ${msgTokenCount} tokens, exceeding the limit of ${msgTokenMax} tokens`;
  }

  return msgTokenCount;
}

async function usingDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return dbUtils.usingDatabase(_dbFilePath, run);
}

export async function hasMultipleUsers(): Promise<boolean> {
  return await usingDatabase(async (db) => {
    const users = await db.all("SELECT * FROM Users");

    return users.length > 1;
  });
}

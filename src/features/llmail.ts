import { Database } from "sqlite";
import table from "text-table";
import * as config from "../config.js";
import { myUserId, usingDatabase } from "../services/dbService.js";
import * as utilities from "../utils/utilities.js";

/** Threading is not currently used in `simpleMode` so this doesn't matter */
const _threadTokenMax = config.agent.mailMessageTokenMax
  ? config.agent.mailMessageTokenMax * 5
  : undefined;

/** The 'non-simple' version of this is a thread first mail system. Where agents can create threads, add users, and reply to threads, etc..
 * The problem with this was the agents were too chatty with so many mail commands, wasting context replying, reading threads, etc..
 * Simple mode only has two commands. It still requires db persistance to support offline agents. */
export const simpleMode = true;

export async function handleCommand(
  args: string,
): Promise<{ content: string; pauseSeconds?: number }> {
  const argParams = args.split(" ");
  let content: string;
  let pauseSeconds: number | undefined;

  if (!argParams[0]) {
    argParams[0] = "help";
  }

  const tokenMaxNote = config.agent.mailMessageTokenMax
    ? ` ${config.agent.mailMessageTokenMax} token max`
    : "";

  switch (argParams[0]) {
    case "help": {
      if (simpleMode) {
        content = `llmail <command>
  users: Get list of users on the system
  send "<users>" "subject" "message": Send a message.${tokenMaxNote}
  wait <seconds>: Pause the session until a new mail message is received
  
* Attachments are not supported, use file paths to refence files in emails as all users are usually on the same machine`;
      } else {
        content = `llmail <command>
  list: List all active threads
  users: Get list of users on the system
  send "<users>" "subject" "message": Send a new mail, starting a new thread
  wait <seconds>: Pause the session until a new mail message is received
  read <id>: Read a thread
  reply <id> <message>: Reply to a thread
  adduser <id> <username>: Add a user to thread with id
  archive <ids>: Archives a comma separated list of threads`;
      }
      break;
    }

    case "list": {
      content = await listThreads();
      break;
    }
    case "send": {
      const newParams = argParams.slice(1).join(" ").split('"');

      if (newParams.length < 6) {
        throw "Invalid parameters. There should be a username, subject and message. All contained in quotes.";
      }

      const usernames = newParams[1].split(",").map((u) => u.trim());
      const subject = newParams[3];
      const message = newParams[5];

      content = await newThread(usernames, subject, message);
      break;
    }

    case "wait": {
      pauseSeconds = argParams[1]
        ? parseInt(argParams[1])
        : config.shellCommand.maxTimeoutSeconds;

      content = `Waiting ${pauseSeconds} seconds for new mail messages...`;
      break;
    }
    case "read": {
      const threadId = parseInt(argParams[1]);

      content = await readThread(threadId);
      break;
    }

    case "users": {
      content = await listUsers();
      break;
    }

    case "reply": {
      const threadId = parseInt(argParams[1]);
      const message = argParams.slice(2).join(" ");

      content = await replyThread(threadId, message);
      break;
    }

    case "adduser": {
      const threadId = parseInt(argParams[1]);
      const username = argParams[2];
      content = await addUser(threadId, username);
      break;
    }

    case "archive": {
      const threadIds = argParams
        .slice(1)
        .join(" ")
        .split(",")
        .map((id) => parseInt(id));

      content = await archiveThreads(threadIds);
      break;
    }

    // Debug level 'secret command'. Don't let the LLM know about this
    /*case "reset": {
      const hostPath = _dbFilePath.toHostPath();
      if (fs.existsSync(hostPath)) {
        fs.unlinkSync(hostPath);
      }
      await init();
      content = "llmail database reset";
      break;
    }*/

    default:
      const helpResponse = await handleCommand("help");
      content =
        "Error, unknown command. See valid commands below:\n" +
        helpResponse.content;
      break;
  }

  return { content, pauseSeconds };
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
      [myUserId],
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
      [myUserId],
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

export async function newThread(
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
          [thread.lastID, user.id, user.id === myUserId ? -1 : 0],
        );
      } else {
        await db.run("ROLLBACK");
        throw `Error: User ${username} not found`;
      }
    }

    // Add message
    await db.run(
      "INSERT INTO ThreadMessages (threadId, userId, message, date) VALUES (?, ?, ?, ?)",
      [thread.lastID, myUserId, message, new Date().toISOString()],
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
      `SELECT u.username, u.title, tm.date, tm.message
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
          `Title: ${message.title}\n` +
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
      [threadId, myUserId],
    );
  });
}

async function listUsers() {
  return await usingDatabase(async (db) => {
    let userList: {
      username: string;
      title: string;
      leadUsername?: string;
      lastActive: string;
      active?: boolean;
    }[] = [];

    userList = await db.all(
      "SELECT * FROM Users",
    );

    userList = userList.map((u) => ({
      ...u,
      active: u.lastActive
        ? new Date(u.lastActive).getTime() > Date.now() - 5 * 1000 // 5 seconds
        : false,
    }));

    return table(
      [
        ["Username", "Title", "Lead", "Status"],
        ...userList.map((ul) => [
          ul.username,
          ul.title,
          ul.leadUsername || "",
          ul.active ? "Online" : "Offline",
        ]),
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
      [thread.id, myUserId, message, new Date().toISOString()],
    );

    // Mark thread has new message only if it hasnt already been marked
    await db.run(
      `UPDATE ThreadMembers 
        SET newMsgId = ?, archived = 0  
        WHERE newMsgId = -1 AND threadId = ? AND userId != ?`,
      [insertedMessage.lastID, thread.id, myUserId],
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
      [myUserId],
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

export async function hasMultipleUsers(): Promise<boolean> {
  return await usingDatabase(async (db) => {
    const users = await db.all("SELECT * FROM Users");

    return users.length > 1;
  });
}

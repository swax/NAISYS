import table from "text-table";
import { createConfig } from "../config.js";
import { createDatabaseService } from "../services/dbService.js";
import * as utilities from "../utils/utilities.js";
import { Prisma, PrismaClient } from "@naisys/database";

export function createLLMail(
  config: Awaited<ReturnType<typeof createConfig>>,
  {
    myUserId,
    usingDatabase,
  }: Awaited<ReturnType<typeof createDatabaseService>>,
) {
  /** Threading is not currently used in `simpleMode` so this doesn't matter */
  const _threadTokenMax = config.agent.mailMessageTokenMax
    ? config.agent.mailMessageTokenMax * 5
    : undefined;

  /** The 'non-simple' version of this is a thread first mail system. Where agents can create threads, add users, and reply to threads, etc..
   * The problem with this was the agents were too chatty with so many mail commands, wasting context replying, reading threads, etc..
   * Simple mode only has two commands. It still requires db persistance to support offline agents. */
  const simpleMode = true;

  async function handleCommand(
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
  async function getUnreadThreads(): Promise<UnreadThread[]> {
    return await usingDatabase(async (prisma) => {
      const updatedThreads = await prisma.$queryRaw<UnreadThread[]>(
        Prisma.sql`SELECT threadId, newMsgId
        FROM ThreadMembers
        WHERE userId = ${myUserId} AND newMsgId >= 0 AND archived = 0`,
      );

      return updatedThreads;
    });
  }

  async function listThreads(): Promise<string> {
    return await usingDatabase(async (prisma) => {
      const threads = await prisma.$queryRaw<
        Array<{
          id: number;
          subject: string;
          date: string;
          tokenCount: number;
          members: string;
        }>
      >(
        Prisma.sql`SELECT t.id, t.subject, max(msg.date) as date, t.tokenCount,
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
        WHERE member.userId = ${myUserId} AND member.archived = 0
        GROUP BY t.id, t.subject
        ORDER BY max(msg.date)`,
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

    return await usingDatabase(async (prisma) => {
      return await prisma.$transaction(async (tx) => {
        // Create thread
        const thread = await tx.threads.create({
          data: {
            subject,
            tokenCount: msgTokenCount,
          },
        });

        // Add users
        for (const username of usernames) {
          const user = await tx.users.findUnique({
            where: { username },
          });

          if (user) {
            await tx.threadMembers.create({
              data: {
                threadId: thread.id,
                userId: user.id,
                newMsgId: user.id === myUserId ? -1 : 0,
              },
            });
          } else {
            throw `Error: User ${username} not found`;
          }
        }

        // Add message
        await tx.threadMessages.create({
          data: {
            threadId: thread.id,
            userId: myUserId,
            message,
            date: new Date().toISOString(),
          },
        });

        return simpleMode
          ? "Mail sent"
          : `Thread created with id ${thread.id}`;
      });
    });
  }

  async function readThread(
    threadId: number,
    newMsgId?: number,
    /** For checking new messages and getting a token count, while not showing the user */
    peek?: boolean,
  ): Promise<string> {
    return await usingDatabase(async (prisma) => {
      const thread = await getThread(prisma, threadId);

      const threadMembers = await prisma.$queryRaw<
        Array<{ id: number; username: string }>
      >(
        Prisma.sql`SELECT u.id, u.username
         FROM ThreadMembers tm
         JOIN Users u ON tm.userId = u.id
         WHERE tm.threadId = ${threadId}`,
      );

      let unreadFilter = "";
      if (newMsgId != undefined) {
        unreadFilter = `AND tm.id >= ${newMsgId}`;
      }

      const messages = await prisma.$queryRaw<
        Array<{
          username: string;
          title: string;
          date: string;
          message: string;
        }>
      >(
        Prisma.sql([
          `SELECT u.username, u.title, tm.date, tm.message
         FROM ThreadMessages tm
         JOIN Users u ON tm.userId = u.id
         WHERE tm.threadId = ${threadId} ${unreadFilter}
         ORDER BY tm.date`,
        ]),
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
          `Thread ${thread.id}: ${thread.subject}\n` +
          `Members: ${toMembers}\n`;

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

  async function markAsRead(threadId: number) {
    await usingDatabase(async (prisma) => {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE ThreadMembers
        SET newMsgId = -1
        WHERE threadId = ${threadId} AND userId = ${myUserId}`,
      );
    });
  }

  async function listUsers() {
    return await usingDatabase(async (prisma) => {
      let userList = await prisma.users.findMany();

      const enrichedUserList = userList.map((u) => ({
        ...u,
        active: u.lastActive
          ? new Date(u.lastActive).getTime() > Date.now() - 5 * 1000 // 5 seconds
          : false,
      }));

      return table(
        [
          ["Username", "Title", "Lead", "Status"],
          ...enrichedUserList.map((ul) => [
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

  async function getAllUserNames() {
    return await usingDatabase(async (prisma) => {
      const usersList = await prisma.users.findMany({
        select: { username: true },
      });

      return usersList.map((ul) => ul.username);
    });
  }

  async function replyThread(threadId: number, message: string) {
    message = message.replace(/\\n/g, "\n");

    // Validate message does not exceed token limit
    const msgTokenCount = validateMsgTokenCount(message);

    return await usingDatabase(async (prisma) => {
      const thread = await getThread(prisma, threadId);

      const newThreadTokenTotal = thread.tokenCount + msgTokenCount;

      if (_threadTokenMax && newThreadTokenTotal > _threadTokenMax) {
        throw `Error: Reply is ${msgTokenCount} tokens and thread is ${thread.tokenCount} tokens.
Reply would cause thread to exceed total thread token limit of ${_threadTokenMax} tokens.
Consider archiving this thread and starting a new one.`;
      }

      const insertedMessage = await prisma.threadMessages.create({
        data: {
          threadId: thread.id,
          userId: myUserId,
          message,
          date: new Date().toISOString(),
        },
      });

      // Mark thread has new message only if it hasnt already been marked
      await prisma.$executeRaw(
        Prisma.sql`UPDATE ThreadMembers
        SET newMsgId = ${insertedMessage.id}, archived = 0
        WHERE newMsgId = -1 AND threadId = ${thread.id} AND userId != ${myUserId}`,
      );

      // Update token total
      await prisma.threads.update({
        where: { id: thread.id },
        data: { tokenCount: newThreadTokenTotal },
      });

      return `Message added to thread ${threadId}`;
    });
  }

  async function addUser(threadId: number, username: string) {
    return await usingDatabase(async (prisma) => {
      const thread = await getThread(prisma, threadId);
      const user = await getUser(prisma, username);

      await prisma.threadMembers.create({
        data: {
          threadId: thread.id,
          userId: user.id,
          newMsgId: 0,
        },
      });

      return `User ${username} added to thread ${threadId}`;
    });
  }

  async function archiveThreads(threadIds: number[]) {
    return await usingDatabase(async (prisma) => {
      await prisma.threadMembers.updateMany({
        where: {
          threadId: { in: threadIds },
          userId: myUserId,
        },
        data: {
          archived: 1,
        },
      });

      return `Threads ${threadIds.join(",")} archived`;
    });
  }

  async function getThread(prisma: PrismaClient, threadId: number) {
    const thread = await prisma.threads.findUnique({
      where: { id: threadId },
    });

    if (!thread) {
      throw `Error: Thread ${threadId} not found`;
    }

    return thread;
  }

  async function getUser(prisma: PrismaClient, username: string) {
    const user = await prisma.users.findUnique({
      where: { username },
    });

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

  async function hasMultipleUsers(): Promise<boolean> {
    return await usingDatabase(async (prisma) => {
      const count = await prisma.users.count();

      return count > 1;
    });
  }

  return {
    simpleMode,
    handleCommand,
    getUnreadThreads,
    newThread,
    readThread,
    markAsRead,
    getAllUserNames,
    hasMultipleUsers,
  };
}

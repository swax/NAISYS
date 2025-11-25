import { Prisma, PrismaClient } from "@naisys/database";
import table from "text-table";
import { GlobalConfig } from "../globalConfig.js";
import { AgentConfig } from "../agentConfig.js";
import { DatabaseService } from "../services/dbService.js";
import { RunService } from "../services/runService.js";
import * as utilities from "../utils/utilities.js";

export function createLLMail(
  globalConfig: GlobalConfig,
  agentConfig: AgentConfig,
  { usingDatabase }: DatabaseService,
  runService: RunService,
) {
  const myUserId = runService.getUserId();

  console.log(`LLMail initialized for user ID ${myUserId}`);

  /** Threading is not currently used in `simpleMode` so this doesn't matter */
  const _threadTokenMax = agentConfig.mailMessageTokenMax
    ? agentConfig.mailMessageTokenMax * 5
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

    const tokenMaxNote = agentConfig.mailMessageTokenMax
      ? ` ${agentConfig.mailMessageTokenMax} token max`
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
          : globalConfig.shellCommand.maxTimeoutSeconds;

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
    thread_id: number;
    new_msg_id: number;
  }
  async function getUnreadThreads(): Promise<UnreadThread[]> {
    return await usingDatabase(async (prisma) => {
      const updatedThreads = await prisma.thread_members.findMany({
        where: {
          user_id: myUserId,
          new_msg_id: { gte: 0 },
          archived: 0,
        },
        select: {
          thread_id: true,
          new_msg_id: true,
        },
      });

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
          token_count: number;
          members: string;
        }>
      >(
        Prisma.sql`SELECT t.id, t.subject, max(msg.date) as date, t.token_count,
      (
            SELECT GROUP_CONCAT(u.username, ', ')
            FROM thread_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.thread_id = t.id
            GROUP BY tm.thread_id
        ) AS members
        FROM threads t
        JOIN thread_messages msg ON t.id = msg.thread_id
        JOIN thread_members member ON t.id = member.thread_id
        WHERE member.user_id = ${myUserId} AND member.archived = 0
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
            `${t.token_count}/${_threadTokenMax ? _threadTokenMax : "∞"}`,
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
    if (!usernames.includes(agentConfig.username)) {
      usernames.push(agentConfig.username);
    }

    message = message.replace(/\\n/g, "\n");

    const msgTokenCount = validateMsgTokenCount(message);

    return await usingDatabase(async (prisma) => {
      return await prisma.$transaction(async (tx) => {
        // Create thread
        const thread = await tx.threads.create({
          data: {
            subject,
            token_count: msgTokenCount,
          },
        });

        // Add users
        for (const username of usernames) {
          const user = await tx.users.findUnique({
            where: { username },
          });

          if (user) {
            await tx.thread_members.create({
              data: {
                thread_id: thread.id,
                user_id: user.id,
                new_msg_id: user.id === myUserId ? -1 : 0,
              },
            });
          } else {
            throw `Error: User ${username} not found`;
          }
        }

        // Add message
        await tx.thread_messages.create({
          data: {
            thread_id: thread.id,
            user_id: myUserId,
            message,
            date: new Date().toISOString(),
          },
        });

        // Set latest_mail_id for users/members of the thread
        // Get user IDs for the usernames
        const threadUsers = await tx.users.findMany({
          where: {
            username: { in: usernames },
          },
          select: {
            id: true,
          },
        });

        // Update user_notifications for all thread members
        await tx.user_notifications.updateMany({
          where: {
            user_id: { in: threadUsers.map((u) => u.id) },
          },
          data: {
            latest_mail_id: thread.id,
            modified_date: new Date().toISOString(),
          },
        });

        return simpleMode ? "Mail sent" : `Thread created with id ${thread.id}`;
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

      const threadMembers = await prisma.thread_members.findMany({
        where: { thread_id: threadId },
        select: {
          users: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });
      // Flatten the nested user object
      const flattenedMembers = threadMembers.map((tm) => tm.users);

      const messages = await prisma.thread_messages.findMany({
        where: {
          thread_id: threadId,
          ...(newMsgId !== undefined ? { id: { gte: newMsgId } } : {}),
        },
        include: {
          users: {
            select: {
              username: true,
              title: true,
            },
          },
        },
        orderBy: {
          date: "asc",
        },
      });

      // Flatten the nested user object for messages
      const flattenedMessages = messages.map((m) => ({
        username: m.users.username,
        title: m.users.title,
        date: m.date,
        message: m.message,
      }));

      let threadMessages = "";

      // If simple mode just show subject/from/to
      // Buildings strings with \n here because otherwise this code is super hard to read
      if (simpleMode) {
        for (const message of flattenedMessages) {
          const toMembers = flattenedMembers
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
        const toMembers = flattenedMembers.map((m) => m.username).join(", ");
        threadMessages =
          `Thread ${thread.id}: ${thread.subject}\n` +
          `Members: ${toMembers}\n`;

        for (const message of flattenedMessages) {
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
        Prisma.sql`UPDATE thread_members
        SET new_msg_id = -1
        WHERE thread_id = ${threadId} AND user_id = ${myUserId}`,
      );
    });
  }

  async function listUsers() {
    return await usingDatabase(async (prisma) => {
      let userList = await prisma.users.findMany({
        select: {
          username: true,
          title: true,
          lead_username: true,
          run_sessions: {
            select: {
              last_active: true,
            },
            orderBy: {
              last_active: "desc",
            },
            take: 1,
          },
        },
      });

      const enrichedUserList = userList.map((u) => {
        const lastActive = u.run_sessions.at(0)?.last_active;
        return {
          username: u.username,
          title: u.title,
          lead_username: u.lead_username,
          active: lastActive
            ? new Date(lastActive).getTime() > Date.now() - 5 * 1000 // 5 seconds
            : false,
        };
      });

      return table(
        [
          ["Username", "Title", "Lead", "Status"],
          ...enrichedUserList.map((ul) => [
            ul.username,
            ul.title,
            ul.lead_username || "",
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

      const newThreadTokenTotal = thread.token_count + msgTokenCount;

      if (_threadTokenMax && newThreadTokenTotal > _threadTokenMax) {
        throw `Error: Reply is ${msgTokenCount} tokens and thread is ${thread.token_count} tokens.
Reply would cause thread to exceed total thread token limit of ${_threadTokenMax} tokens.
Consider archiving this thread and starting a new one.`;
      }

      const insertedMessage = await prisma.thread_messages.create({
        data: {
          thread_id: thread.id,
          user_id: myUserId,
          message,
          date: new Date().toISOString(),
        },
      });

      // Mark thread has new message only if it hasnt already been marked
      await prisma.$executeRaw(
        Prisma.sql`UPDATE thread_members
        SET new_msg_id = ${insertedMessage.id}, archived = 0
        WHERE new_msg_id = -1 AND thread_id = ${thread.id} AND user_id != ${myUserId}`,
      );

      // Update token total
      await prisma.threads.update({
        where: { id: thread.id },
        data: { token_count: newThreadTokenTotal },
      });

      return `Message added to thread ${threadId}`;
    });
  }

  async function addUser(threadId: number, username: string) {
    return await usingDatabase(async (prisma) => {
      const thread = await getThread(prisma, threadId);
      const user = await getUser(prisma, username);

      await prisma.thread_members.create({
        data: {
          thread_id: thread.id,
          user_id: user.id,
          new_msg_id: 0,
        },
      });

      return `User ${username} added to thread ${threadId}`;
    });
  }

  async function archiveThreads(threadIds: number[]) {
    return await usingDatabase(async (prisma) => {
      await prisma.thread_members.updateMany({
        where: {
          thread_id: { in: threadIds },
          user_id: myUserId,
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
    const msgTokenMax = agentConfig.mailMessageTokenMax;

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

export type LLMail = ReturnType<typeof createLLMail>;

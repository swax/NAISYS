import {
  SendMailRequest,
  SendMailResponse,
  ThreadMember,
  ThreadMessage,
} from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { getAgents } from "./agentService.js";
import { updateLatestMailIds } from "./readService.js";
import fs from "fs/promises";
import path from "path";

export async function getThreadMessages(
  after?: number,
  limit: number = 1000,
): Promise<ThreadMessage[]> {
  try {
    const dbMessages = await usingNaisysDb(async (prisma) => {
      return await prisma.thread_messages.findMany({
        where: after !== undefined && after > 0 ? { id: { gt: after } } : undefined,
        orderBy: { id: 'desc' },
        take: limit,
        select: {
          id: true,
          thread_id: true,
          user_id: true,
          message: true,
          date: true,
          threads: {
            select: { subject: true },
          },
          users: {
            select: { username: true },
          },
        },
      });
    });

    // Resort ascending
    dbMessages.sort((a, b) => a.id - b.id);

    // Get unique thread IDs to fetch members
    const threadIds = [...new Set(dbMessages.map((msg) => msg.thread_id))];

    // Fetch members for all threads
    const membersMap = await getThreadMembersMap(threadIds);

    const messages = dbMessages.map((msg) => ({
      id: msg.id,
      threadId: msg.thread_id,
      userId: msg.user_id,
      username: msg.users.username,
      subject: msg.threads.subject,
      message: msg.message,
      date: msg.date,
      members: membersMap[msg.thread_id] || [],
    }));

    // Used for tracking unread mails
    await updateLatestMailIds(messages);

    return messages;
  } catch (error) {
    console.error(
      "Error fetching thread messages from Naisys database:",
      error,
    );
    return [];
  }
}

async function getThreadMembersMap(
  threadIds: number[],
): Promise<Record<number, ThreadMember[]>> {
  if (threadIds.length === 0) return {};

  try {
    const dbMembers = await usingNaisysDb(async (prisma) => {
      return await prisma.thread_members.findMany({
        where: { thread_id: { in: threadIds } },
        select: {
          thread_id: true,
          user_id: true,
          new_msg_id: true,
          archived: true,
          users: {
            select: { username: true },
          },
        },
      });
    });

    const membersMap: Record<number, ThreadMember[]> = {};

    dbMembers.forEach((member) => {
      if (!membersMap[member.thread_id]) {
        membersMap[member.thread_id] = [];
      }

      membersMap[member.thread_id].push({
        userId: member.user_id,
        username: member.users.username,
        newMsgId: member.new_msg_id,
        archived: member.archived === 1,
      });
    });

    return membersMap;
  } catch (error) {
    console.error("Error fetching thread members from Naisys database:", error);
    return {};
  }
}

/**
 * Very similar to the llmail.ts newThread function in NAISYS
 * https://github.com/swax/NAISYS/blob/main/src/features/llmail.ts#L196
 */
export async function sendMessage(
  request: SendMailRequest,
): Promise<SendMailResponse> {
  try {
    const { from, to, subject, message, attachments } = request;

    // Clean message (handle escaped newlines)
    let cleanMessage = message.replace(/\\n/g, "\n");

    // Get all agents to validate users
    const agents = await getAgents();

    // 1. Validate the 'from' user exists
    const fromUser = agents.find((agent) => agent.name === from);
    if (!fromUser) {
      return {
        success: false,
        message: `Error: User ${from} not found`,
      };
    }

    // 2. Validate the 'to' user exists
    const toUser = agents.find((agent) => agent.name === to);
    if (!toUser) {
      return {
        success: false,
        message: `Error: User ${to} not found`,
      };
    }

    const messageId = await usingNaisysDb(async (prisma) => {
      // 3. Create new thread
      const thread = await prisma.threads.create({
        data: {
          subject,
          token_count: 0, // TODO
        },
      });

      const threadId = thread.id;

      // Add both users to the thread
      await prisma.thread_members.createMany({
        data: [
          { thread_id: threadId, user_id: fromUser.id, new_msg_id: -1 },
          { thread_id: threadId, user_id: toUser.id, new_msg_id: 0 },
        ],
      });

      // 4. Insert new message into thread_messages table
      const threadMessage = await prisma.thread_messages.create({
        data: {
          thread_id: threadId,
          user_id: fromUser.id,
          message: cleanMessage,
          date: new Date().toISOString(),
        },
      });

      return threadMessage.id;
    });

    // 5. Handle attachments if any
    if (attachments && attachments.length > 0) {
      const naisysFolderPath = process.env.NAISYS_FOLDER;
      if (!naisysFolderPath) {
        throw new Error("NAISYS_FOLDER environment variable not set");
      }

      const attachmentsDir = path.join(naisysFolderPath, "attachments", messageId.toString());
      await saveAttachments(messageId, attachments);

      // Create detailed attachment info
      const attachmentDetails = attachments.map(att => {
        const sizeKB = (att.data.length / 1024).toFixed(1);
        return `${att.filename} (${sizeKB} KB)`;
      }).join(', ');

      const attachmentCount = attachments.length;
      const updatedMessage = `${cleanMessage}\n\n${attachmentCount} attached file${attachmentCount > 1 ? 's' : ''}, located in ${attachmentsDir}\nFilenames: ${attachmentDetails}`;

      // Update the message with attachment info
      await usingNaisysDb(async (prisma) => {
        await prisma.thread_messages.update({
          where: { id: messageId },
          data: { message: updatedMessage },
        });
      });
    }

    return {
      success: true,
      message: "Message sent successfully",
      messageId,
    };
  } catch (error) {
    console.error("Error sending message:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to send message",
    };
  }
}

async function saveAttachments(messageId: number, attachments: Array<{ filename: string; data: Buffer }>) {
  const naisysFolderPath = process.env.NAISYS_FOLDER;
  if (!naisysFolderPath) {
    throw new Error("NAISYS_FOLDER environment variable not set");
  }

  const attachmentsDir = path.join(naisysFolderPath, "attachments", messageId.toString());
  
  // Create the directory
  await fs.mkdir(attachmentsDir, { recursive: true });

  // Save each attachment
  for (const attachment of attachments) {
    const filePath = path.join(attachmentsDir, attachment.filename);
    await fs.writeFile(filePath, attachment.data);
  }
}

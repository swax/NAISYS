import {
  SendMailRequest,
  SendMailResponse,
  ThreadMember,
  ThreadMessage,
} from "shared/src/mail-types.js";
import {
  runOnNaisysDb,
  selectFromNaisysDb,
} from "../database/naisysDatabase.js";
import { getAgents } from "./agentService.js";
import { updateLatestMailIds } from "./readService.js";
import fs from "fs/promises";
import path from "path";

interface NaisysThreadMessage {
  id: number;
  threadId: number;
  userId: number;
  username: string;
  subject: string;
  message: string;
  date: string;
}

interface NaisysThreadMember {
  threadId: number;
  userId: number;
  username: string;
  newMsgId: number;
  archived: number;
}

export async function getThreadMessages(
  after?: number,
  limit: number = 1000,
): Promise<ThreadMessage[]> {
  try {
    let sql = `
      SELECT 
        tm.id, 
        tm.threadId, 
        tm.userId, 
        u.username,
        t.subject,
        tm.message, 
        tm.date
      FROM ThreadMessages tm
      JOIN Threads t ON tm.threadId = t.id
      JOIN Users u ON tm.userId = u.id
    `;
    const params: any[] = [];

    const conditions: string[] = [];

    if (after !== undefined && after > 0) {
      conditions.push("tm.id > ?");
      params.push(after);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY tm.id DESC LIMIT ?";
    params.push(limit);

    const dbMessages = await selectFromNaisysDb<NaisysThreadMessage[]>(
      sql,
      params,
    );

    // Resort ascending
    dbMessages.sort((a, b) => a.id - b.id);

    // Get unique thread IDs to fetch members
    const threadIds = [...new Set(dbMessages.map((msg) => msg.threadId))];

    // Fetch members for all threads
    const membersMap = await getThreadMembersMap(threadIds);

    const messages = dbMessages.map((msg) => ({
      id: msg.id,
      threadId: msg.threadId,
      userId: msg.userId,
      username: msg.username,
      subject: msg.subject,
      message: msg.message,
      date: msg.date,
      members: membersMap[msg.threadId] || [],
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
    const placeholders = threadIds.map(() => "?").join(",");
    const sql = `
      SELECT 
        tm.threadId,
        tm.userId,
        u.username,
        tm.newMsgId,
        tm.archived
      FROM ThreadMembers tm
      JOIN Users u ON tm.userId = u.id
      WHERE tm.threadId IN (${placeholders})
    `;

    const dbMembers = await selectFromNaisysDb<NaisysThreadMember[]>(
      sql,
      threadIds,
    );

    const membersMap: Record<number, ThreadMember[]> = {};

    dbMembers.forEach((member) => {
      if (!membersMap[member.threadId]) {
        membersMap[member.threadId] = [];
      }

      membersMap[member.threadId].push({
        userId: member.userId,
        username: member.username,
        newMsgId: member.newMsgId,
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

    // 3. Create new thread
    const threadResult = await runOnNaisysDb(
      "INSERT INTO Threads (subject, tokenCount) VALUES (?, ?)",
      [subject, 0], // TODO
    );

    const threadId = threadResult.lastID!;

    // Add both users to the thread
    await runOnNaisysDb(
      "INSERT INTO ThreadMembers (threadId, userId, newMsgId) VALUES (?, ?, ?), (?, ?, ?)",
      [threadId, fromUser.id, -1, threadId, toUser.id, 0],
    );

    // 4. Insert new message into ThreadMessages table
    const messageResult = await runOnNaisysDb(
      "INSERT INTO ThreadMessages (threadId, userId, message, date) VALUES (?, ?, ?, ?)",
      [threadId, fromUser.id, cleanMessage, new Date().toISOString()],
    );

    const messageId = messageResult.lastID!;

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
      await runOnNaisysDb(
        "UPDATE ThreadMessages SET message = ? WHERE id = ?",
        [updatedMessage, messageId],
      );
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

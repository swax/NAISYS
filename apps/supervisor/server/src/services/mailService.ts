import { ulid } from "@naisys/database";
import {
  SendMailRequest,
  SendMailResponse,
  MailMessage,
} from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { getAgents } from "./agentService.js";
import fs from "fs/promises";
import path from "path";

/**
 * Get mail data for a specific agent, optionally filtering by updatedSince
 */
export async function getMailData(
  agentName: string,
  updatedSince?: string,
  page: number = 1,
  count: number = 50,
): Promise<{ mail: MailMessage[]; timestamp: string; total?: number }> {
  try {
    // First, find the agent to get their userId
    const agents = await getAgents();
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      return {
        mail: [],
        timestamp: new Date().toISOString(),
      };
    }

    const userId = agent.id;

    // Build the where clause
    const whereClause: any = {};

    // If updatedSince is provided, filter by date
    if (updatedSince) {
      whereClause.created_at = { gte: updatedSince };
    }

    // Fetch messages where the user is sender or recipient
    const result = await usingNaisysDb(async (prisma) => {
      const where = {
        ...whereClause,
        OR: [
          { from_user_id: userId },
          {
            recipients: {
              some: {
                user_id: userId,
              },
            },
          },
        ],
      };

      // Only get total count on initial fetch (when updatedSince is not set)
      const total = updatedSince
        ? undefined
        : await prisma.mail_messages.count({ where });

      // Get paginated messages
      const dbMessages = await prisma.mail_messages.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * count,
        take: count,
        select: {
          id: true,
          from_user_id: true,
          subject: true,
          body: true,
          created_at: true,
          from_user: {
            select: { username: true },
          },
          recipients: {
            select: {
              user_id: true,
              type: true,
              user: {
                select: { username: true },
              },
            },
          },
        },
      });

      return { dbMessages, total };
    });

    const messages: MailMessage[] = result.dbMessages.map((msg) => ({
      id: msg.id,
      fromUserId: msg.from_user_id,
      fromUsername: msg.from_user.username,
      subject: msg.subject,
      body: msg.body,
      createdAt: msg.created_at.toISOString(),
      recipients: msg.recipients.map((r) => ({
        userId: r.user_id,
        username: r.user.username,
        type: r.type,
      })),
    }));

    return {
      mail: messages,
      timestamp: new Date().toISOString(),
      total: result.total,
    };
  } catch (error) {
    console.error("Error fetching mail data:", error);
    return {
      mail: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Send a message using the new flat message model
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
      const msgId = ulid();

      // Create the message
      await prisma.mail_messages.create({
        data: {
          id: msgId,
          from_user_id: fromUser.id,
          subject,
          body: cleanMessage,
          created_at: new Date(),
        },
      });

      // Create recipient entry
      await prisma.mail_recipients.create({
        data: {
          id: ulid(),
          message_id: msgId,
          user_id: toUser.id,
          type: "to",
          created_at: new Date(),
        },
      });

      return msgId;
    });

    // 5. Handle attachments if any
    if (attachments && attachments.length > 0) {
      const naisysFolderPath = process.env.NAISYS_FOLDER;
      if (!naisysFolderPath) {
        throw new Error("NAISYS_FOLDER environment variable not set");
      }

      const attachmentsDir = path.join(
        naisysFolderPath,
        "attachments",
        messageId,
      );
      await saveAttachments(messageId, attachments);

      // Create detailed attachment info
      const attachmentDetails = attachments
        .map((att) => {
          const sizeKB = (att.data.length / 1024).toFixed(1);
          return `${att.filename} (${sizeKB} KB)`;
        })
        .join(", ");

      const attachmentCount = attachments.length;
      const updatedMessage = `${cleanMessage}\n\n${attachmentCount} attached file${attachmentCount > 1 ? "s" : ""}, located in ${attachmentsDir}\nFilenames: ${attachmentDetails}`;

      // Update the message with attachment info
      await usingNaisysDb(async (prisma) => {
        await prisma.mail_messages.update({
          where: { id: messageId },
          data: { body: updatedMessage },
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

async function saveAttachments(
  messageId: string,
  attachments: Array<{ filename: string; data: Buffer }>,
) {
  const naisysFolderPath = process.env.NAISYS_FOLDER;
  if (!naisysFolderPath) {
    throw new Error("NAISYS_FOLDER environment variable not set");
  }

  const attachmentsDir = path.join(
    naisysFolderPath,
    "attachments",
    messageId,
  );

  // Create the directory
  await fs.mkdir(attachmentsDir, { recursive: true });

  // Save each attachment
  for (const attachment of attachments) {
    const filePath = path.join(attachmentsDir, attachment.filename);
    await fs.writeFile(filePath, attachment.data);
  }
}

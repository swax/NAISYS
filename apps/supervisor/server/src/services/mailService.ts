import {
  MailMessage,
  SendMailRequest,
  SendMailResponse,
} from "@naisys-supervisor/shared";
import fs from "fs/promises";
import path from "path";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { getLogger } from "../logger.js";
import { cachedForSeconds } from "../utils/cache.js";
import { getAgents } from "./agentService.js";
import { sendMailViaHub } from "./hubConnectionService.js";

/**
 * Get mail data for a specific agent by userId, optionally filtering by updatedSince
 */
export const getMailDataByUserId = cachedForSeconds(
  0.25,
  async (
    userId: number,
    updatedSince?: string,
    page: number = 1,
    count: number = 50,
  ): Promise<{ mail: MailMessage[]; timestamp: string; total?: number }> => {
    try {
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
        fromUserId: msg.from_user_id ?? 0,
        fromUsername: msg.from_user?.username ?? "(deleted)",
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
      getLogger().error(error, "Error fetching mail data");
      return {
        mail: [],
        timestamp: new Date().toISOString(),
      };
    }
  },
);

/**
 * Send a message via the hub
 */
export async function sendMessage(
  request: SendMailRequest,
): Promise<SendMailResponse> {
  try {
    const { from, to, subject, message, attachments } = request;

    // Clean message (handle escaped newlines)
    let cleanMessage = message.replace(/\\n/g, "\n");

    // Get all agents to validate the 'from' user exists
    const agents = await getAgents();
    const fromUser = agents.find((agent) => agent.name === from);
    if (!fromUser) {
      return {
        success: false,
        message: `Error: User ${from} not found`,
      };
    }

    // Save attachments and append info to message body
    if (attachments && attachments.length > 0) {
      const naisysFolderPath = process.env.NAISYS_FOLDER;
      if (!naisysFolderPath) {
        throw new Error("NAISYS_FOLDER environment variable not set");
      }

      // Use a timestamp-based folder since we don't have a message ID yet
      const attachmentId = Date.now();
      const attachmentsDir = path.join(
        naisysFolderPath,
        "attachments",
        String(attachmentId),
      );
      await saveAttachments(attachmentsDir, attachments);

      const attachmentDetails = attachments
        .map((att) => {
          const sizeKB = (att.data.length / 1024).toFixed(1);
          return `${att.filename} (${sizeKB} KB)`;
        })
        .join(", ");

      const attachmentCount = attachments.length;
      cleanMessage = `${cleanMessage}\n\n${attachmentCount} attached file${attachmentCount > 1 ? "s" : ""}, located in ${attachmentsDir}\nFilenames: ${attachmentDetails}`;
    }

    const response = await sendMailViaHub(
      fromUser.id,
      [to],
      subject,
      cleanMessage,
    );

    if (response.success) {
      return {
        success: true,
        message: "Message sent successfully",
      };
    } else {
      return {
        success: false,
        message: response.error || "Failed to send message",
      };
    }
  } catch (error) {
    getLogger().error(error, "Error sending message");
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to send message",
    };
  }
}

async function saveAttachments(
  attachmentsDir: string,
  attachments: Array<{ filename: string; data: Buffer }>,
) {
  await fs.mkdir(attachmentsDir, { recursive: true });

  for (const attachment of attachments) {
    const filePath = path.join(attachmentsDir, attachment.filename);
    await fs.writeFile(filePath, attachment.data);
  }
}

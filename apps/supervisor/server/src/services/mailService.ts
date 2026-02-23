import {
  MailMessage,
  SendMailRequest,
  SendMailResponse,
} from "@naisys-supervisor/shared";

import { hubDb } from "../database/hubDb.js";
import { getLogger } from "../logger.js";
import { cachedForSeconds } from "../utils/cache.js";
import { uploadToHub } from "./attachmentProxyService.js";
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
    kind: string = "mail",
  ): Promise<{ mail: MailMessage[]; timestamp: string; total?: number }> => {
    try {
      // Build the where clause
      const whereClause: any = { kind };

      // If updatedSince is provided, filter by date
      if (updatedSince) {
        whereClause.created_at = { gte: updatedSince };
      }

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
        : await hubDb.mail_messages.count({ where });

      // Get paginated messages
      const dbMessages = await hubDb.mail_messages.findMany({
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
          attachments: {
            select: { id: true, filename: true, file_size: true },
          },
        },
      });

      const messages: MailMessage[] = dbMessages.map((msg) => ({
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
        attachments:
          msg.attachments.length > 0
            ? msg.attachments.map((a) => ({
                id: a.id,
                filename: a.filename,
                fileSize: a.file_size,
              }))
            : undefined,
      }));

      return {
        mail: messages,
        timestamp: new Date().toISOString(),
        total,
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
 * Send a message via the hub, uploading any attachments first
 */
export async function sendMessage(
  request: SendMailRequest,
  attachments?: Array<{ filename: string; data: Buffer }>,
): Promise<SendMailResponse> {
  try {
    const { fromId, toId, subject, message } = request;

    // Clean message (handle escaped newlines)
    const cleanMessage = message.replace(/\\n/g, "\n");

    // Upload attachments to hub and collect IDs
    let attachmentIds: number[] | undefined;
    if (attachments && attachments.length > 0) {
      attachmentIds = [];
      for (const attachment of attachments) {
        const id = await uploadToHub(
          attachment.data,
          attachment.filename,
          fromId,
        );
        attachmentIds.push(id);
      }
    }

    const response = await sendMailViaHub(
      fromId,
      [toId],
      subject,
      cleanMessage,
      "mail",
      attachmentIds,
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

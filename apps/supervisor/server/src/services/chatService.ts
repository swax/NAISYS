import { ChatConversation, ChatMessage } from "@naisys-supervisor/shared";

import { hubDb } from "../database/hubDb.js";
import { getLogger } from "../logger.js";
import { cachedForSeconds } from "../utils/cache.js";
import { sendMailViaHub } from "./hubConnectionService.js";

/**
 * Get chat conversations for a user, grouped by participant_ids
 */
export const getConversations = cachedForSeconds(
  0.25,
  async (userId: number): Promise<ChatConversation[]> => {
    try {
      // Get distinct conversations where this user is a participant
      const messages = await hubDb.mail_messages.findMany({
        where: {
          kind: "chat",
          participant_ids: { not: null },
          OR: [
            { from_user_id: userId },
            { recipients: { some: { user_id: userId } } },
          ],
        },
        orderBy: { created_at: "desc" },
        select: {
          participant_ids: true,
          body: true,
          created_at: true,
          from_user: { select: { username: true } },
        },
      });

      // Group by participant_ids and take the latest message for each
      const conversationMap = new Map<
        string,
        {
          lastMessage: string;
          lastMessageAt: Date;
          lastMessageFrom: string;
        }
      >();

      for (const msg of messages) {
        const pids = msg.participant_ids!;
        if (!conversationMap.has(pids)) {
          conversationMap.set(pids, {
            lastMessage: msg.body,
            lastMessageAt: msg.created_at,
            lastMessageFrom: msg.from_user?.username ?? "(deleted)",
          });
        }
      }

      // Look up participant usernames
      const conversations: ChatConversation[] = [];
      for (const [participantIds, conv] of conversationMap) {
        const ids = participantIds.split(",").map(Number);
        const users = await hubDb.users.findMany({
          where: { id: { in: ids } },
          select: { id: true, username: true },
        });

        // Exclude the current user from participant names
        const participantNames = users
          .filter((u) => u.id !== userId)
          .map((u) => u.username);

        conversations.push({
          participantIds,
          participantNames,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt.toISOString(),
          lastMessageFrom: conv.lastMessageFrom,
        });
      }

      // Sort by latest message time (newest first)
      conversations.sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime(),
      );

      return conversations;
    } catch (error) {
      getLogger().error(error, "Error fetching chat conversations");
      return [];
    }
  },
);

/**
 * Get chat messages for a specific conversation
 */
export const getMessages = cachedForSeconds(
  0.25,
  async (
    userId: number,
    participantIds: string,
    updatedSince?: string,
    page: number = 1,
    count: number = 50,
  ): Promise<{
    messages: ChatMessage[];
    total?: number;
    timestamp: string;
  }> => {
    try {
      const whereClause: any = {
        kind: "chat",
        participant_ids: participantIds,
      };

      if (updatedSince) {
        whereClause.created_at = { gte: updatedSince };
      }

      // Only get total on initial fetch
      const total = updatedSince
        ? undefined
        : await hubDb.mail_messages.count({ where: whereClause });

      const dbMessages = await hubDb.mail_messages.findMany({
        where: whereClause,
        orderBy: { id: "desc" },
        skip: (page - 1) * count,
        take: count,
        select: {
          id: true,
          from_user_id: true,
          body: true,
          created_at: true,
          from_user: { select: { username: true } },
          attachments: {
            select: { id: true, filename: true, file_size: true },
          },
        },
      });

      const messages: ChatMessage[] = dbMessages.map((msg) => ({
        id: msg.id,
        fromUserId: msg.from_user_id ?? 0,
        fromUsername: msg.from_user?.username ?? "(deleted)",
        body: msg.body,
        createdAt: msg.created_at.toISOString(),
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
        messages,
        total,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      getLogger().error(error, "Error fetching chat messages");
      return {
        messages: [],
        timestamp: new Date().toISOString(),
      };
    }
  },
);

/**
 * Send a chat message via the hub
 */
export async function sendChatMessage(
  fromId: number,
  toIds: number[],
  message: string,
  attachmentIds?: number[],
): Promise<{ success: boolean; message?: string }> {
  try {
    const cleanMessage = message.replace(/\\n/g, "\n");
    const response = await sendMailViaHub(
      fromId,
      toIds,
      "",
      cleanMessage,
      "chat",
      attachmentIds,
    );

    if (response.success) {
      return { success: true, message: "Chat message sent" };
    } else {
      return {
        success: false,
        message: response.error || "Failed to send chat message",
      };
    }
  } catch (error) {
    getLogger().error(error, "Error sending chat message");
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to send chat message",
    };
  }
}

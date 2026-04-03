import type { ChatConversation, ChatMessage } from "@naisys/supervisor-shared";

import { hubDb } from "../database/hubDb.js";
import { getLogger } from "../logger.js";
import { sendMailViaHub } from "./hubConnectionService.js";

/**
 * Get chat conversations for a user, grouped by participants
 */
export async function getConversations(
  userId: number,
  page: number = 1,
  count: number = 50,
): Promise<{ conversations: ChatConversation[]; total: number }> {
  // Look up the current user's username for filtering
  const currentUser = await hubDb.users.findUnique({
    where: { id: userId },
    select: { username: true },
  });
  const currentUsername = currentUser?.username;

  // Get distinct conversations where this user is a participant
  const messages = await hubDb.mail_messages.findMany({
    where: {
      kind: "chat",
      participants: { not: "" },
      OR: [
        { from_user_id: userId },
        { recipients: { some: { user_id: userId } } },
      ],
    },
    orderBy: { created_at: "desc" },
    select: {
      participants: true,
      body: true,
      created_at: true,
      from_user: { select: { username: true, title: true } },
      recipients: {
        where: { user_id: userId },
        select: { archived_at: true },
      },
    },
  });

  // Look up titles for all participant usernames
  const allUsernames = new Set<string>();
  for (const msg of messages) {
    for (const name of msg.participants.split(",")) {
      allUsernames.add(name);
    }
  }
  const users = await hubDb.users.findMany({
    where: { username: { in: [...allUsernames] } },
    select: { username: true, title: true },
  });
  const titleMap = new Map(users.map((u) => [u.username, u.title]));

  // Group by participants and take the latest message for each
  const conversationMap = new Map<
    string,
    {
      lastMessage: string;
      lastMessageAt: Date;
      lastMessageFrom: string;
      recipientRecords: Array<{ archived_at: Date | null }>;
    }
  >();

  for (const msg of messages) {
    const key = msg.participants;
    const existing = conversationMap.get(key);
    if (!existing) {
      conversationMap.set(key, {
        lastMessage: msg.body,
        lastMessageAt: msg.created_at,
        lastMessageFrom: msg.from_user.username,
        recipientRecords: [...msg.recipients],
      });
    } else {
      existing.recipientRecords.push(...msg.recipients);
    }
  }

  // participants field already contains usernames, just split
  const conversations: ChatConversation[] = [];
  for (const [participants, conv] of conversationMap) {
    const names = participants.split(",");

    // Exclude the current user from participant names
    const participantNames = currentUsername
      ? names.filter((n) => n !== currentUsername)
      : names;

    // Conversation is archived if there are recipient records and all are archived
    const isArchived =
      conv.recipientRecords.length > 0 &&
      conv.recipientRecords.every((r) => r.archived_at !== null);

    conversations.push({
      participants,
      participantNames,
      participantTitles: participantNames.map((n) => titleMap.get(n) ?? ""),
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt.toISOString(),
      lastMessageFrom: conv.lastMessageFrom,
      isArchived,
    });
  }

  // Sort by latest message time (newest first)
  conversations.sort(
    (a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );

  const total = conversations.length;
  const start = (page - 1) * count;
  const paginated = conversations.slice(start, start + count);

  return { conversations: paginated, total };
}

/**
 * Get chat messages for a specific conversation
 */
export async function getMessages(
  participants: string,
  updatedSince?: string,
  page: number = 1,
  count: number = 50,
): Promise<{
  messages: ChatMessage[];
  total?: number;
  timestamp: string;
}> {
  const whereClause: any = {
    kind: "chat",
    participants,
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
      from_user: { select: { username: true, title: true } },
      recipients: {
        select: { user_id: true, read_at: true, type: true },
      },
      mail_attachments: {
        include: {
          attachment: {
            select: { id: true, filename: true, file_size: true },
          },
        },
      },
    },
  });

  const messages: ChatMessage[] = dbMessages.map((msg) => {
    const readByIds = msg.recipients
      .filter((r) => r.read_at !== null && r.type !== "from")
      .map((r) => r.user_id);

    return {
      id: msg.id,
      fromUserId: msg.from_user_id,
      fromUsername: msg.from_user.username,
      fromTitle: msg.from_user.title,
      body: msg.body,
      createdAt: msg.created_at.toISOString(),
      attachments:
        msg.mail_attachments.length > 0
          ? msg.mail_attachments.map((ma) => ({
              id: ma.attachment.id,
              filename: ma.attachment.filename,
              fileSize: ma.attachment.file_size,
            }))
          : undefined,
      readBy: readByIds.length > 0 ? readByIds : undefined,
    };
  });

  return {
    messages,
    total,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Archive all chat messages where the user is a recipient
 */
export async function archiveAllChatMessages(userId: number): Promise<number> {
  const result = await hubDb.mail_recipients.updateMany({
    where: {
      user_id: userId,
      archived_at: null,
      message: {
        kind: "chat",
      },
    },
    data: {
      archived_at: new Date(),
    },
  });
  return result.count;
}

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

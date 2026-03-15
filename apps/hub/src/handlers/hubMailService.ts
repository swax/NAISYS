import type { HubDatabaseService } from "@naisys/hub-database";
import {
  HubEvents,
  MailArchiveRequestSchema,
  MailListRequestSchema,
  MailMarkReadRequestSchema,
  MailPeekRequestSchema,
  MailSearchRequestSchema,
  MailSendRequestSchema,
  MailUnreadRequestSchema,
} from "@naisys/hub-protocol";

import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubAgentService } from "./hubAgentService.js";
import type { HubConfigService } from "./hubConfigService.js";
import type { HubCostService } from "./hubCostService.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";
import { HubSendMailService } from "./hubSendMailService.js";

const MAIL_AUTOSTART_CHECK_INTERVAL_MS = 10_000;

/** Handles mail events from NAISYS instances */
export function createHubMailService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
  sendMailService: HubSendMailService,
  agentService: HubAgentService,
  costService: HubCostService,
  configService: HubConfigService,
) {
  /** Check for inactive users with unread mail and trigger auto-start for each */
  async function checkPendingAutoStarts() {
    try {
      const config = configService.getConfig();
      if (!config.success || !config.config?.autoStartAgentsOnMessage) return;

      const activeUserIds = heartbeatService.getActiveUserIds();

      // Find distinct users with unread mail from real senders
      const unreadRecipients = await hubDb.mail_recipients.findMany({
        where: {
          read_at: null,
          user: { enabled: true, archived: false },
        },
        select: {
          user_id: true,
        },
        distinct: ["user_id"],
      });

      const inactiveUserIds = unreadRecipients
        .map((recipient) => recipient.user_id)
        .filter((userId) => !activeUserIds.has(userId));

      if (inactiveUserIds.length === 0) return;

      await costService.checkSpendLimits(inactiveUserIds);

      for (const userId of inactiveUserIds) {
        if (heartbeatService.getActiveUserIds().has(userId)) continue;
        if (costService.isUserSpendSuspended(userId)) continue;
        void agentService.tryStartAgent(userId);
      }
    } catch (error) {
      logService.error(`[Hub:Mail] Auto-start check failed: ${error}`);
    }
  }

  // When a NAISYS host connects, check for pending unread mail and auto-start agents
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    (_hostId, connection) => {
      if (connection.getHostType() === "naisys") {
        void checkPendingAutoStarts();
      }
    },
  );

  const pendingAutoStartInterval = setInterval(
    () => void checkPendingAutoStarts(),
    MAIL_AUTOSTART_CHECK_INTERVAL_MS,
  );

  // MAIL_SEND
  naisysServer.registerEvent(HubEvents.MAIL_SEND, async (hostId, data, ack) => {
    try {
      const parsed = MailSendRequestSchema.parse(data);

      await sendMailService.sendMail({
        fromUserId: parsed.fromUserId,
        recipientUserIds: parsed.toUserIds,
        subject: parsed.subject,
        body: parsed.body,
        kind: parsed.kind,
        hostId,
        attachmentIds: parsed.attachmentIds,
      });

      ack({ success: true });

      void checkPendingAutoStarts();
    } catch (error) {
      logService.error(
        `[Hub:Mail] mail_send error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });

  // MAIL_LIST
  naisysServer.registerEvent(HubEvents.MAIL_LIST, async (hostId, data, ack) => {
    try {
      const parsed = MailListRequestSchema.parse(data);

      // Build ownership condition based on filter
      let ownershipCondition;
      if (parsed.withUserIds?.length) {
        // Messages between exactly this group of participants
        const allUserIds = [...new Set([parsed.userId, ...parsed.withUserIds])];
        const users = await hubDb.users.findMany({
          where: { id: { in: allUserIds } },
          select: { username: true },
        });
        const participants = users
          .map((u) => u.username)
          .sort()
          .join(",");
        ownershipCondition = { participants };
      } else if (parsed.filter === "received") {
        ownershipCondition = {
          recipients: { some: { user_id: parsed.userId } },
        };
      } else if (parsed.filter === "sent") {
        ownershipCondition = { from_user_id: parsed.userId };
      } else {
        ownershipCondition = {
          OR: [
            { from_user_id: parsed.userId },
            { recipients: { some: { user_id: parsed.userId } } },
          ],
        };
      }

      const messages = await hubDb.mail_messages.findMany({
        where: {
          ...ownershipCondition,
          kind: parsed.kind,
          NOT: {
            recipients: {
              some: {
                user_id: parsed.userId,
                archived_at: { not: null },
              },
            },
          },
        },
        include: {
          from_user: { select: { username: true, title: true } },
          recipients: {
            include: { user: { select: { username: true } } },
          },
          mail_attachments: {
            include: {
              attachment: {
                select: { id: true, filename: true, file_size: true },
              },
            },
          },
        },
        orderBy: { created_at: "desc" },
        skip: parsed.skip,
        take: parsed.take ?? 20,
      });

      const messageData = messages.map((m) => {
        const myRecipient = m.recipients.find(
          (r) => r.user_id === parsed.userId,
        );
        const isUnread =
          m.from_user_id !== parsed.userId && !myRecipient?.read_at;

        return {
          id: m.id,
          fromUsername: m.from_user.username,
          fromTitle: m.from_user.title,
          recipientUsernames: m.recipients.map((r) => r.user.username),
          subject: m.subject,
          createdAt: m.created_at.toISOString(),
          isUnread,
          ...(parsed.kind === "chat" ? { body: m.body } : {}),
          attachments: m.mail_attachments.length
            ? m.mail_attachments.map((ma) => ({
                id: ma.attachment.id,
                filename: ma.attachment.filename,
                fileSize: ma.attachment.file_size,
              }))
            : undefined,
        };
      });

      ack({ success: true, messages: messageData });
    } catch (error) {
      logService.error(
        `[Hub:Mail] mail_list error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });

  // MAIL_PEEK
  naisysServer.registerEvent(HubEvents.MAIL_PEEK, async (hostId, data, ack) => {
    try {
      const parsed = MailPeekRequestSchema.parse(data);

      const message = await hubDb.mail_messages.findUnique({
        where: { id: parsed.messageId },
        include: {
          from_user: { select: { username: true, title: true } },
          recipients: {
            include: { user: { select: { username: true } } },
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

      if (!message) {
        ack({
          success: false,
          error: `Message ${parsed.messageId} not found`,
        });
        return;
      }

      ack({
        success: true,
        message: {
          id: message.id,
          subject: message.subject,
          fromUsername: message.from_user.username,
          fromTitle: message.from_user.title,
          recipientUsernames: message.recipients.map((r) => r.user.username),
          createdAt: message.created_at.toISOString(),
          body: message.body,
          attachments: message.mail_attachments.length
            ? message.mail_attachments.map((ma) => ({
                id: ma.attachment.id,
                filename: ma.attachment.filename,
                fileSize: ma.attachment.file_size,
              }))
            : undefined,
        },
      });
    } catch (error) {
      logService.error(
        `[Hub:Mail] mail_peek error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });

  // MAIL_MARK_READ
  naisysServer.registerEvent(
    HubEvents.MAIL_MARK_READ,
    async (hostId, data, ack) => {
      try {
        const parsed = MailMarkReadRequestSchema.parse(data);

        const result = await hubDb.mail_recipients.updateMany({
          where: {
            message_id: { in: parsed.messageIds },
            user_id: parsed.userId,
            read_at: null,
          },
          data: { read_at: new Date() },
        });

        ack({ success: true });

        // Push read receipts to supervisor connections
        if (result.count > 0) {
          const messages = await hubDb.mail_messages.findMany({
            where: { id: { in: parsed.messageIds } },
            select: { participants: true },
          });

          // participants is like the room id, we broadcast to all rooms the read message ids
          // It's ok if the specific message id is not in the room, the client will ignore it
          const participants = [
            ...new Set(messages.map((m) => m.participants)),
          ];

          const payload = {
            messageIds: parsed.messageIds,
            userId: parsed.userId,
            kind: parsed.kind,
            participants,
          };

          naisysServer.broadcastToSupervisors(HubEvents.MAIL_READ_PUSH, payload);
        }
      } catch (error) {
        logService.error(
          `[Hub:Mail] mail_mark_read error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_ARCHIVE
  naisysServer.registerEvent(
    HubEvents.MAIL_ARCHIVE,
    async (hostId, data, ack) => {
      try {
        const parsed = MailArchiveRequestSchema.parse(data);

        const archivedIds: number[] = [];

        for (const messageId of parsed.messageIds) {
          const message = await hubDb.mail_messages.findUnique({
            where: { id: messageId },
          });

          if (!message) {
            ack({
              success: false,
              error: `Message ${messageId} not found`,
            });
            return;
          }

          await hubDb.mail_recipients.updateMany({
            where: { message_id: message.id, user_id: parsed.userId },
            data: { archived_at: new Date() },
          });

          archivedIds.push(messageId);
        }

        ack({ success: true, archivedIds });
      } catch (error) {
        logService.error(
          `[Hub:Mail] mail_archive error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_SEARCH
  naisysServer.registerEvent(
    HubEvents.MAIL_SEARCH,
    async (hostId, data, ack) => {
      try {
        const parsed = MailSearchRequestSchema.parse(data);

        const searchCondition = parsed.subjectOnly
          ? { subject: { contains: parsed.terms } }
          : {
              OR: [
                { subject: { contains: parsed.terms } },
                { body: { contains: parsed.terms } },
              ],
            };

        const archiveCondition = parsed.includeArchived
          ? {}
          : {
              NOT: {
                recipients: {
                  some: {
                    user_id: parsed.userId,
                    archived_at: { not: null },
                  },
                },
              },
            };

        const messages = await hubDb.mail_messages.findMany({
          where: {
            OR: [
              { from_user_id: parsed.userId },
              { recipients: { some: { user_id: parsed.userId } } },
            ],
            ...searchCondition,
            ...archiveCondition,
          },
          include: {
            from_user: { select: { username: true } },
          },
          orderBy: { created_at: "desc" },
          take: 50,
        });

        const messageData = messages.map((m) => ({
          id: m.id,
          subject: m.subject,
          fromUsername: m.from_user.username,
          createdAt: m.created_at.toISOString(),
        }));

        ack({ success: true, messages: messageData });
      } catch (error) {
        logService.error(
          `[Hub:Mail] mail_search error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_UNREAD
  naisysServer.registerEvent(
    HubEvents.MAIL_UNREAD,
    async (hostId, data, ack) => {
      try {
        const parsed = MailUnreadRequestSchema.parse(data);

        const messages = await hubDb.mail_messages.findMany({
          where: {
            kind: parsed.kind,
            ...(parsed.afterId ? { id: { gt: parsed.afterId } } : {}),
            recipients: {
              some: { user_id: parsed.userId, read_at: null },
            },
          },
          include: {
            from_user: { select: { username: true, title: true } },
            recipients: {
              include: { user: { select: { username: true } } },
            },
            mail_attachments: {
              include: {
                attachment: {
                  select: { id: true, filename: true, file_size: true },
                },
              },
            },
          },
          orderBy: { id: "asc" },
        });

        ack({
          success: true,
          messages: messages.map((m) => ({
            id: m.id,
            subject: m.subject,
            fromUsername: m.from_user.username,
            fromTitle: m.from_user.title,
            recipientUsernames: m.recipients.map((r) => r.user.username),
            createdAt: m.created_at.toISOString(),
            body: m.body,
            attachments: m.mail_attachments.length
              ? m.mail_attachments.map((ma) => ({
                  id: ma.attachment.id,
                  filename: ma.attachment.filename,
                  fileSize: ma.attachment.file_size,
                }))
              : undefined,
          })),
        });
      } catch (error) {
        logService.error(
          `[Hub:Mail] mail_unread error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  function cleanup() {
    clearInterval(pendingAutoStartInterval);
  }

  return { cleanup };
}

export type HubMailService = ReturnType<typeof createHubMailService>;

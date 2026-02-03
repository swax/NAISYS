import { DatabaseService, ulid } from "@naisys/database";
import {
  HubEvents,
  MailArchiveRequestSchema,
  MailArchiveResponse,
  MailListRequestSchema,
  MailListResponse,
  MailReadRequestSchema,
  MailReadResponse,
  MailSearchRequestSchema,
  MailSearchResponse,
  MailSendRequestSchema,
  MailSendResponse,
  MailUnreadRequestSchema,
  MailUnreadResponse,
} from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";

/** Handles mail events from NAISYS instances */
export function createHubMailService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
) {
  // MAIL_SEND
  naisysServer.registerEvent(
    HubEvents.MAIL_SEND,
    async (
      hostId: string,
      data: unknown,
      ack: (response: MailSendResponse) => void,
    ) => {
      try {
        const parsed = MailSendRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
          // Resolve usernames to user IDs
          const resolvedUsers = await prisma.users.findMany({
            where: { username: { in: parsed.toUsernames }, deleted_at: null },
            select: { id: true, username: true },
          });

          const foundNames = new Set(resolvedUsers.map((u) => u.username));
          const missing = parsed.toUsernames.filter(
            (n) => !foundNames.has(n),
          );
          if (missing.length > 0) {
            ack({
              success: false,
              error: `Users not found: ${missing.join(", ")}`,
            });
            return;
          }

          // Create message
          const messageId = ulid();
          await prisma.mail_messages.create({
            data: {
              id: messageId,
              from_user_id: parsed.fromUserId,
              host_id: hostId,
              subject: parsed.subject,
              body: parsed.body,
              created_at: new Date(),
            },
          });

          // Create recipient entries in batch
          const now = new Date();
          await prisma.mail_recipients.createMany({
            data: resolvedUsers.map((user) => ({
              id: ulid(),
              message_id: messageId,
              user_id: user.id,
              type: "to",
              created_at: now,
            })),
          });

          // Update latest_mail_id on user_notifications for all recipients
          const recipientUserIds = resolvedUsers.map((u) => u.id);
          await prisma.user_notifications.updateMany({
            where: { user_id: { in: recipientUserIds } },
            data: { latest_mail_id: messageId },
          });

          // Push MAIL_RECEIVED only to hosts that have active recipients
          const targetHostIds = new Set<string>();

          for (const userId of recipientUserIds) {
            const hostId = heartbeatService.findHostForAgent(userId);
            if (hostId) {
              targetHostIds.add(hostId);
            }
          }

          if (targetHostIds.size > 0) {
            const payload = { recipientUserIds };
            for (const targetHostId of targetHostIds) {
              naisysServer.sendMessage(
                targetHostId,
                HubEvents.MAIL_RECEIVED,
                payload,
              );
            }
          }

          ack({ success: true });
        });
      } catch (error) {
        logService.error(
          `[HubMailService] mail_send error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_LIST
  naisysServer.registerEvent(
    HubEvents.MAIL_LIST,
    async (
      hostId: string,
      data: unknown,
      ack: (response: MailListResponse) => void,
    ) => {
      try {
        const parsed = MailListRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
          // Build ownership condition based on filter
          const ownershipCondition =
            parsed.filter === "received"
              ? { recipients: { some: { user_id: parsed.userId } } }
              : parsed.filter === "sent"
                ? { from_user_id: parsed.userId }
                : {
                    OR: [
                      { from_user_id: parsed.userId },
                      { recipients: { some: { user_id: parsed.userId } } },
                    ],
                  };

          const messages = await prisma.mail_messages.findMany({
            where: {
              ...ownershipCondition,
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
              from_user: { select: { username: true } },
              recipients: {
                include: { user: { select: { username: true } } },
              },
            },
            orderBy: { created_at: "desc" },
            take: 20,
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
              recipientUsernames: m.recipients.map((r) => r.user.username),
              subject: m.subject,
              createdAt: m.created_at.toISOString(),
              isUnread,
            };
          });

          ack({ success: true, messages: messageData });
        });
      } catch (error) {
        logService.error(
          `[HubMailService] mail_list error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_READ
  naisysServer.registerEvent(
    HubEvents.MAIL_READ,
    async (
      hostId: string,
      data: unknown,
      ack: (response: MailReadResponse) => void,
    ) => {
      try {
        const parsed = MailReadRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
          // Find message by short ID (endsWith)
          const messages = await prisma.mail_messages.findMany({
            where: { id: { endsWith: parsed.messageId } },
            include: {
              from_user: { select: { username: true, title: true } },
              recipients: {
                include: { user: { select: { username: true } } },
              },
            },
          });

          if (messages.length === 0) {
            ack({
              success: false,
              error: `Message ${parsed.messageId} not found`,
            });
            return;
          }

          if (messages.length > 1) {
            ack({
              success: false,
              error: `Multiple messages match '${parsed.messageId}'. Please use more characters.`,
            });
            return;
          }

          const message = messages[0];

          // Mark as read
          await prisma.mail_recipients.updateMany({
            where: {
              message_id: message.id,
              user_id: parsed.userId,
              read_at: null,
            },
            data: { read_at: new Date() },
          });

          ack({
            success: true,
            message: {
              id: message.id,
              subject: message.subject,
              fromUsername: message.from_user.username,
              fromTitle: message.from_user.title,
              recipientUsernames: message.recipients.map(
                (r) => r.user.username,
              ),
              createdAt: message.created_at.toISOString(),
              body: message.body,
            },
          });
        });
      } catch (error) {
        logService.error(
          `[HubMailService] mail_read error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_ARCHIVE
  naisysServer.registerEvent(
    HubEvents.MAIL_ARCHIVE,
    async (
      hostId: string,
      data: unknown,
      ack: (response: MailArchiveResponse) => void,
    ) => {
      try {
        const parsed = MailArchiveRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
          const archivedIds: string[] = [];

          for (const shortId of parsed.messageIds) {
            const messages = await prisma.mail_messages.findMany({
              where: { id: { endsWith: shortId } },
            });

            if (messages.length === 0) {
              ack({
                success: false,
                error: `Message ${shortId} not found`,
              });
              return;
            }

            if (messages.length > 1) {
              ack({
                success: false,
                error: `Multiple messages match '${shortId}'. Please use more characters.`,
              });
              return;
            }

            const message = messages[0];
            await prisma.mail_recipients.updateMany({
              where: { message_id: message.id, user_id: parsed.userId },
              data: { archived_at: new Date() },
            });

            archivedIds.push(shortId);
          }

          ack({ success: true, archivedIds });
        });
      } catch (error) {
        logService.error(
          `[HubMailService] mail_archive error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_SEARCH
  naisysServer.registerEvent(
    HubEvents.MAIL_SEARCH,
    async (
      hostId: string,
      data: unknown,
      ack: (response: MailSearchResponse) => void,
    ) => {
      try {
        const parsed = MailSearchRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
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

          const messages = await prisma.mail_messages.findMany({
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
        });
      } catch (error) {
        logService.error(
          `[HubMailService] mail_search error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_UNREAD
  naisysServer.registerEvent(
    HubEvents.MAIL_UNREAD,
    async (
      hostId: string,
      data: unknown,
      ack: (response: MailUnreadResponse) => void,
    ) => {
      try {
        const parsed = MailUnreadRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
          const messages = await prisma.mail_messages.findMany({
            where: {
              recipients: {
                some: { user_id: parsed.userId, read_at: null },
              },
            },
            select: { id: true },
          });

          ack({
            success: true,
            messageIds: messages.map((m) => m.id),
          });
        });
      } catch (error) {
        logService.error(
          `[HubMailService] mail_unread error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );
}

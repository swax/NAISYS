import type { HubDatabaseService } from "@naisys/hub-database";
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
  MailReceivedPush,
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
  { usingHubDatabase }: HubDatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
) {
  /** Send a mail message directly by user IDs */
  async function sendMail(params: {
    fromUserId: number | null;
    recipientUserIds: number[];
    subject: string;
    body: string;
    hostId?: number;
  }) {
    await usingHubDatabase(async (hubDb) => {
      const now = new Date();

      const message = await hubDb.mail_messages.create({
        data: {
          from_user_id: params.fromUserId,
          host_id: params.hostId,
          subject: params.subject,
          body: params.body,
          created_at: now,
        },
      });

      await hubDb.mail_recipients.createMany({
        data: params.recipientUserIds.map((userId) => ({
          message_id: message.id,
          user_id: userId,
          type: "to",
          created_at: now,
        })),
      });

      await hubDb.user_notifications.updateMany({
        where: { user_id: { in: params.recipientUserIds } },
        data: { latest_mail_id: message.id },
      });

      for (const userId of params.recipientUserIds) {
        heartbeatService.updateAgentNotification(
          userId,
          "latestMailId",
          message.id,
        );
      }
      heartbeatService.throttledPushAgentsStatus();

      const targetHostIds = new Set<number>();
      for (const userId of params.recipientUserIds) {
        for (const hId of heartbeatService.findHostsForAgent(userId)) {
          targetHostIds.add(hId);
        }
      }

      if (targetHostIds.size > 0) {
        const payload: MailReceivedPush = {
          recipientUserIds: params.recipientUserIds,
        };
        for (const targetHostId of targetHostIds) {
          naisysServer.sendMessage<MailReceivedPush>(
            targetHostId,
            HubEvents.MAIL_RECEIVED,
            payload,
          );
        }
      }
    });
  }

  // MAIL_SEND
  naisysServer.registerEvent(
    HubEvents.MAIL_SEND,
    async (
      hostId: number,
      data: unknown,
      ack: (response: MailSendResponse) => void,
    ) => {
      try {
        const parsed = MailSendRequestSchema.parse(data);

        await sendMail({
          fromUserId: parsed.fromUserId,
          recipientUserIds: parsed.toUserIds,
          subject: parsed.subject,
          body: parsed.body,
          hostId,
        });

        ack({ success: true });
      } catch (error) {
        logService.error(
          `[Hub:Mail] mail_send error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_LIST
  naisysServer.registerEvent(
    HubEvents.MAIL_LIST,
    async (
      hostId: number,
      data: unknown,
      ack: (response: MailListResponse) => void,
    ) => {
      try {
        const parsed = MailListRequestSchema.parse(data);

        await usingHubDatabase(async (hubDb) => {
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

          const messages = await hubDb.mail_messages.findMany({
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
              fromUsername: m.from_user?.username ?? "(deleted)",
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
          `[Hub:Mail] mail_list error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_READ
  naisysServer.registerEvent(
    HubEvents.MAIL_READ,
    async (
      hostId: number,
      data: unknown,
      ack: (response: MailReadResponse) => void,
    ) => {
      try {
        const parsed = MailReadRequestSchema.parse(data);

        await usingHubDatabase(async (hubDb) => {
          const message = await hubDb.mail_messages.findUnique({
            where: { id: parsed.messageId },
            include: {
              from_user: { select: { username: true, title: true } },
              recipients: {
                include: { user: { select: { username: true } } },
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

          // Mark as read
          await hubDb.mail_recipients.updateMany({
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
              fromUsername: message.from_user?.username ?? "(deleted)",
              fromTitle: message.from_user?.title ?? "",
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
          `[Hub:Mail] mail_read error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  // MAIL_ARCHIVE
  naisysServer.registerEvent(
    HubEvents.MAIL_ARCHIVE,
    async (
      hostId: number,
      data: unknown,
      ack: (response: MailArchiveResponse) => void,
    ) => {
      try {
        const parsed = MailArchiveRequestSchema.parse(data);

        await usingHubDatabase(async (hubDb) => {
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
        });
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
    async (
      hostId: number,
      data: unknown,
      ack: (response: MailSearchResponse) => void,
    ) => {
      try {
        const parsed = MailSearchRequestSchema.parse(data);

        await usingHubDatabase(async (hubDb) => {
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
            fromUsername: m.from_user?.username ?? "(deleted)",
            createdAt: m.created_at.toISOString(),
          }));

          ack({ success: true, messages: messageData });
        });
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
    async (
      hostId: number,
      data: unknown,
      ack: (response: MailUnreadResponse) => void,
    ) => {
      try {
        const parsed = MailUnreadRequestSchema.parse(data);

        await usingHubDatabase(async (hubDb) => {
          const messages = await hubDb.mail_messages.findMany({
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
          `[Hub:Mail] mail_unread error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  return { sendMail };
}

export type HubMailService = ReturnType<typeof createHubMailService>;

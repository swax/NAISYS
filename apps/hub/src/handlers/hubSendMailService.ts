import type { HubDatabaseService } from "@naisys/hub-database";
import { HubEvents, MailReceivedPush } from "@naisys/hub-protocol";

import { NaisysServer } from "../services/naisysServer.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";

/** Pure send-mail service with no auto-start logic, breaking the circular dependency */
export function createHubSendMailService(
  naisysServer: NaisysServer,
  { usingHubDatabase }: HubDatabaseService,
  heartbeatService: HubHeartbeatService,
) {
  /** Send a mail message directly by user IDs */
  async function sendMail(params: {
    fromUserId: number;
    recipientUserIds: number[];
    subject: string;
    body: string;
    kind: string;
    hostId?: number;
    attachmentIds?: number[];
  }) {
    await usingHubDatabase(async (hubDb) => {
      const now = new Date();

      const participantIds = [params.fromUserId, ...params.recipientUserIds]
        .sort((a, b) => a - b)
        .join(",");

      const message = await hubDb.mail_messages.create({
        data: {
          from_user_id: params.fromUserId,
          host_id: params.hostId,
          kind: params.kind,
          participant_ids: participantIds,
          subject: params.subject,
          body: params.body,
          created_at: now,
        },
      });

      // Link uploaded attachments to the new message via junction table
      if (params.attachmentIds?.length) {
        // Verify all attachment IDs exist
        const found = await hubDb.attachments.findMany({
          where: { id: { in: params.attachmentIds } },
          select: { id: true },
        });
        if (found.length !== params.attachmentIds.length) {
          const foundIds = new Set(found.map((a) => a.id));
          const missing = params.attachmentIds.filter(
            (id) => !foundIds.has(id),
          );
          throw new Error(`Attachments not found: ${missing.join(", ")}`);
        }

        await hubDb.mail_attachments.createMany({
          data: params.attachmentIds.map((attId) => ({
            message_id: message.id,
            attachment_id: attId,
          })),
        });
      }

      await hubDb.mail_recipients.createMany({
        data: params.recipientUserIds.map((userId) => ({
          message_id: message.id,
          user_id: userId,
          type: "to",
          created_at: now,
        })),
      });

      const notificationField =
        params.kind === "chat" ? "latest_chat_id" : "latest_mail_id";
      await hubDb.user_notifications.updateMany({
        where: { user_id: { in: params.recipientUserIds } },
        data: { [notificationField]: message.id },
      });

      const heartbeatField =
        params.kind === "chat" ? "latestChatId" : "latestMailId";
      for (const userId of params.recipientUserIds) {
        heartbeatService.updateAgentNotification(
          userId,
          heartbeatField,
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
          kind: params.kind as MailReceivedPush["kind"],
        };
        for (const targetHostId of targetHostIds) {
          naisysServer.sendMessage(
            targetHostId,
            HubEvents.MAIL_RECEIVED,
            payload,
          );
        }
      }
    });
  }

  return { sendMail };
}

export type HubSendMailService = ReturnType<typeof createHubSendMailService>;

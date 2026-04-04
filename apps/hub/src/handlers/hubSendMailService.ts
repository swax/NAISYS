import type { HubDatabaseService } from "@naisys/hub-database";
import type { MailReceivedPush } from "@naisys/hub-protocol";
import {
  HubEvents,
  type MailPush,
  type MessageKind,
} from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";
import type { HubHeartbeatService } from "./hubHeartbeatService.js";

/** Pure send-mail service with no auto-start logic, breaking the circular dependency */
export function createHubSendMailService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  heartbeatService: HubHeartbeatService,
) {
  /** Send a mail message directly by user IDs */
  async function sendMail(params: {
    fromUserId: number;
    recipientUserIds: number[];
    subject: string;
    body: string;
    kind: MessageKind;
    hostId?: number;
    attachmentIds?: number[];
  }) {
    const now = new Date();

    // Build participants string from usernames (sorted alphabetically)
    const allUserIds = [
      ...new Set([params.fromUserId, ...params.recipientUserIds]),
    ];
    const users = await hubDb.users.findMany({
      where: { id: { in: allUserIds } },
      select: { username: true },
    });
    const participants = users
      .map((u) => u.username)
      .sort()
      .join(",");

    // Atomic transaction: create message, link attachments, add recipients, update notifications
    const message = await hubDb.$transaction(async (hubTx) => {
      const msg = await hubTx.mail_messages.create({
        data: {
          from_user_id: params.fromUserId,
          host_id: params.hostId,
          kind: params.kind,
          participants,
          subject: params.subject,
          body: params.body,
          created_at: now,
        },
      });

      // Link uploaded attachments to the new message via junction table
      if (params.attachmentIds?.length) {
        // Verify all attachment IDs exist
        const found = await hubTx.attachments.findMany({
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

        await hubTx.mail_attachments.createMany({
          data: params.attachmentIds.map((attId) => ({
            message_id: msg.id,
            attachment_id: attId,
          })),
        });
      }

      await hubTx.mail_recipients.createMany({
        data: params.recipientUserIds.map((userId) => ({
          message_id: msg.id,
          user_id: userId,
          type: "to",
          created_at: now,
        })),
      });

      // Add sender as 'from' recipient for archive tracking (pre-read since they wrote it)
      if (!params.recipientUserIds.includes(params.fromUserId)) {
        await hubTx.mail_recipients.create({
          data: {
            message_id: msg.id,
            user_id: params.fromUserId,
            type: "from",
            read_at: now,
            created_at: now,
          },
        });
      }

      const notificationField =
        params.kind === "chat" ? "latest_chat_id" : "latest_mail_id";
      await hubTx.user_notifications.updateMany({
        where: { user_id: { in: params.recipientUserIds } },
        data: { [notificationField]: msg.id },
      });

      return msg;
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
        kind: params.kind,
      };
      for (const targetHostId of targetHostIds) {
        naisysServer.sendMessage(
          targetHostId,
          HubEvents.MAIL_RECEIVED,
          payload,
        );
      }
    }

    // Query attachment metadata for the push if there are attachments
    let attachments: MailPush["attachments"];
    if (params.attachmentIds?.length) {
      const rows = await hubDb.attachments.findMany({
        where: { id: { in: params.attachmentIds } },
        select: { public_id: true, filename: true, file_size: true },
      });
      attachments = rows.map((r) => ({
        id: r.public_id,
        filename: r.filename,
        fileSize: r.file_size,
      }));
    }

    // Push full message data to supervisor connections
    naisysServer.broadcastToSupervisors(HubEvents.MAIL_PUSH, {
      recipientUserIds: params.recipientUserIds,
      fromUserId: params.fromUserId,
      kind: params.kind,
      messageId: message.id,
      subject: params.subject,
      body: params.body,
      createdAt: now.toISOString(),
      participants,
      attachments,
    });
  }

  return { sendMail };
}

export type HubSendMailService = ReturnType<typeof createHubSendMailService>;

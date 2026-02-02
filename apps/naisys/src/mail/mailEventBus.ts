import { EventEmitter } from "events";

/**
 * Shared event bus for immediate mail notifications between agents
 * running in the same process (local mode).
 */
const mailEventBus = new EventEmitter();

/** Content carried with mail delivery */
export interface MailContent {
  fromUsername: string;
  fromTitle: string;
  recipientUsernames: string[];
  subject: string;
  body: string;
  createdAt: string;
}

/** Standard display format for a mail message */
export function formatMessageDisplay(content: MailContent): string {
  return (
    `Subject: ${content.subject}\n` +
    `From: ${content.fromUsername}\n` +
    `Title: ${content.fromTitle}\n` +
    `To: ${content.recipientUsernames.join(", ")}\n` +
    `Date: ${new Date(content.createdAt).toLocaleString()}\n` +
    `Message:\n` +
    `${content.body}`
  );
}

/** Emit a mail delivery event with message content (local mode) */
export function emitMailDelivered(
  recipientUserIds: string[],
  content: MailContent,
) {
  for (const userId of recipientUserIds) {
    mailEventBus.emit("mail_delivered", userId, content);
  }
}

/** Subscribe to mail delivery events with content (local mode) */
export function onMailDelivered(
  userId: string,
  callback: (content: MailContent) => void,
): () => void {
  const handler = (targetUserId: string, content: MailContent) => {
    if (targetUserId === userId) {
      callback(content);
    }
  };
  mailEventBus.on("mail_delivered", handler);
  return () => mailEventBus.off("mail_delivered", handler);
}

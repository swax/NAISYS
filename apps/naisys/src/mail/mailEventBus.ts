import { EventEmitter } from "events";

/**
 * Shared event bus for immediate mail notifications between agents
 * running in the same process. Cross-machine mail still relies on polling.
 */
const mailEventBus = new EventEmitter();

export function emitMailSent(recipientUserIds: string[]) {
  for (const userId of recipientUserIds) {
    mailEventBus.emit("mail", userId);
  }
}

export function onMailReceived(
  userId: string,
  callback: () => void,
): () => void {
  const handler = (targetUserId: string) => {
    if (targetUserId === userId) {
      callback();
    }
  };
  mailEventBus.on("mail", handler);
  return () => mailEventBus.off("mail", handler);
}

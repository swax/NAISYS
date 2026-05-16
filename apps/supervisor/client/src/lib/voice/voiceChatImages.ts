import { isImageFilename } from "@naisys/common";
import type { LogPushEntry, MailPush } from "@naisys/hub-protocol";

import type { LogPushEntryWithUrl } from "./voiceLogImages";

/**
 * Chat-mode image bridge. The voice agent normally only sees content that
 * lands in bob's run log, but inbound chat attachments don't currently
 * `logService.write({filepath})` — they're textified as `[name size]` and
 * the actual image bytes never flow through bob. To close that gap in chat
 * mode, the floating control subscribes to the `chat-messages:` socket room
 * for its participant pair and feeds image attachments straight into the
 * narration scheduler as synthetic log entries.
 *
 * Routing through synthetic entries (rather than a parallel image-only
 * channel) reuses the existing buffer's coalescing, MAX_IMAGES_PER_DIGEST
 * cap, and session-level attachment dedup — a chat image and a screenshot
 * of the same file produce one fetch, not two.
 */

/** Sorted, comma-joined participant set for the chat-messages socket room.
 *  The room key the supervisor broadcasts on is built from the canonical
 *  participant list, so we must sort to match. */
export function chatMessagesRoomKey(participants: string[]): string {
  const unique = Array.from(new Set(participants.filter(Boolean))).sort();
  return `chat-messages:${unique.join(",")}`;
}

/** Build one synthetic log entry per image attachment on a chat message.
 *  Source is `null` (no real log source) so the chat-mode narration filter
 *  passes it through — the filter only blocks `console` and `startPrompt`.
 *  Negative `id`s mark these as synthetic; nothing downstream keys on `id`. */
export function imagesFromChatMessage(msg: MailPush): LogPushEntryWithUrl[] {
  if (msg.kind !== "chat") return [];
  if (!msg.attachments?.length) return [];

  const entries: LogPushEntryWithUrl[] = [];
  let offset = 0;
  for (const a of msg.attachments) {
    if (!isImageFilename(a.filename)) continue;
    const entry: LogPushEntry & { attachmentDownloadUrl?: string } = {
      id: -((msg.messageId ?? 0) * 1000 + offset++),
      previousId: null,
      userId: 0,
      runId: 0,
      sessionId: 0,
      role: "NAISYS",
      source: null,
      type: null,
      message: `[chat attachment: ${a.filename}]`,
      createdAt: msg.createdAt,
      attachmentId: a.id,
      attachmentFilename: a.filename,
      attachmentFileSize: a.fileSize,
    };
    entries.push(entry);
  }
  return entries;
}

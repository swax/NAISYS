import type { MailMessage } from "../../lib/apiClient";

/** Strip leading RE: prefixes and trim; fallback to "(No Subject)" */
export function normalizeSubject(subject: string): string {
  const stripped = subject.replace(/^(RE:\s*)+/i, "").trim();
  return stripped || "(No Subject)";
}

/** Get sorted participant names for a single message (sender + all recipients) */
function getMessageParticipants(msg: MailMessage): string[] {
  const names = new Set<string>();
  names.add(msg.fromUsername);
  for (const r of msg.recipients) {
    names.add(r.username);
  }
  return [...names].sort();
}

/** Build a conversation key; when groupBySubject is true, includes normalized subject */
function conversationKey(msg: MailMessage, groupBySubject: boolean): string {
  const participants = getMessageParticipants(msg).join(",");
  if (!groupBySubject) return participants;
  return `${normalizeSubject(msg.subject)}|${participants}`;
}

export interface MailConversation {
  /** Opaque key for selection/matching (subject + participants) */
  key: string;
  normalizedSubject: string;
  participantNames: string[];
  messageCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageFrom: string;
  maxMailId: number;
  hasUnread: boolean;
}

/**
 * Group mail messages into conversations.
 * When groupBySubject is true, groups by normalized subject + participants.
 * When false, groups by participants only (like chat).
 * Returns conversations sorted by most recent message (newest first).
 */
export function groupIntoConversations(
  mail: MailMessage[],
  lastReadMailId: number | null,
  groupBySubject: boolean,
): MailConversation[] {
  const groups = new Map<string, MailMessage[]>();

  for (const msg of mail) {
    const key = conversationKey(msg, groupBySubject);
    const group = groups.get(key);
    if (group) {
      group.push(msg);
    } else {
      groups.set(key, [msg]);
    }
  }

  const conversations: MailConversation[] = [];

  for (const [key, messages] of groups) {
    // Sort messages newest-first for metadata extraction
    const sorted = [...messages].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const latest = sorted[0];
    const maxMailId = Math.max(...sorted.map((m) => m.id));
    const normalizedSubject = normalizeSubject(latest.subject);

    // Collect unique participant names across all messages in conversation
    const nameSet = new Set<string>();
    for (const msg of sorted) {
      nameSet.add(msg.fromUsername);
      for (const r of msg.recipients) {
        nameSet.add(r.username);
      }
    }

    const hasUnread =
      lastReadMailId !== null ? maxMailId > lastReadMailId : false;

    conversations.push({
      key,
      normalizedSubject,
      participantNames: [...nameSet],
      messageCount: messages.length,
      lastMessageAt: latest.createdAt,
      lastMessagePreview: latest.body.split("\n")[0].slice(0, 100),
      lastMessageFrom: latest.fromUsername,
      maxMailId,
      hasUnread,
    });
  }

  // Sort by most recent message
  conversations.sort(
    (a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );

  return conversations;
}

/**
 * Return all messages for a conversation (by key), sorted oldest-first.
 */
export function getConversationMessages(
  mail: MailMessage[],
  key: string,
  groupBySubject: boolean,
): MailMessage[] {
  return mail
    .filter((msg) => conversationKey(msg, groupBySubject) === key)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

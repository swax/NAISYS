/**
 * Central React Query cache-key factory. Every `queryKey` — and every
 * `invalidateQueries` / `resetQueries` / `setQueryData` call that targets one —
 * routes through here, so a key and the code that reads it can't drift apart
 * and the prefix relationships (a thread key extends its agent's thread list)
 * stay enforced by the types.
 */
export const queryKeys = {
  /** The agent roster. */
  agentData: ["agent-data"] as const,
  /** The host roster. */
  hostData: ["host-data"] as const,
  /** An agent's chat conversation list. */
  chatConversations: (agentUsername: string) =>
    ["chat-conversations", agentUsername] as const,
  /** Every chat thread of an agent — the prefix of `chatThread`, for resetting
   *  them all at once (e.g. archive-all). */
  chatThreads: (agentUsername: string) =>
    ["chat-messages", agentUsername] as const,
  /** One chat thread, identified by its participants string. */
  chatThread: (agentUsername: string, participants: string | null) =>
    ["chat-messages", agentUsername, participants] as const,
  /** An agent's mail list. */
  mailData: (agentUsername: string) => ["mail-data", agentUsername] as const,
  /** One run session's context log. */
  contextLog: (sessionKey: string) => ["context-log", sessionKey] as const,
};

import { z } from "zod";

// =============================================================================
// Common
// =============================================================================

export const MessageKindSchema = z.enum(["mail", "chat"]);
export type MessageKind = z.infer<typeof MessageKindSchema>;

// =============================================================================
// Send
// =============================================================================

/** Request to send a mail message */
export const MailSendRequestSchema = z.object({
  fromUserId: z.number(),
  toUserIds: z.array(z.number()),
  subject: z.string(),
  body: z.string(),
  kind: MessageKindSchema,
});
export type MailSendRequest = z.infer<typeof MailSendRequestSchema>;

/** Response to mail send request */
export const MailSendResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type MailSendResponse = z.infer<typeof MailSendResponseSchema>;

// =============================================================================
// List
// =============================================================================

/** Request to list mail messages */
export const MailListRequestSchema = z.object({
  userId: z.number(),
  filter: z.enum(["received", "sent"]).optional(),
  kind: MessageKindSchema,
  skip: z.number().optional(),
  take: z.number().optional(),
  withUserIds: z.array(z.number()).optional(),
});
export type MailListRequest = z.infer<typeof MailListRequestSchema>;

/** A single message in a mail list response */
export const MailListMessageDataSchema = z.object({
  id: z.number(),
  fromUsername: z.string(),
  recipientUsernames: z.array(z.string()),
  subject: z.string(),
  createdAt: z.string(),
  isUnread: z.boolean(),
  body: z.string().optional(),
});
export type MailListMessageData = z.infer<typeof MailListMessageDataSchema>;

/** Response to mail list request */
export const MailListResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(MailListMessageDataSchema).optional(),
  error: z.string().optional(),
});
export type MailListResponse = z.infer<typeof MailListResponseSchema>;

// =============================================================================
// Peek (fetch without marking as read)
// =============================================================================

/** Request to peek at a specific mail message */
export const MailPeekRequestSchema = z.object({
  userId: z.number(),
  messageId: z.number(),
});
export type MailPeekRequest = z.infer<typeof MailPeekRequestSchema>;

/** Full message data returned when fetching a message */
export const MailMessageDataSchema = z.object({
  id: z.number(),
  subject: z.string(),
  fromUsername: z.string(),
  fromTitle: z.string(),
  recipientUsernames: z.array(z.string()),
  createdAt: z.string(),
  body: z.string(),
});
export type MailMessageData = z.infer<typeof MailMessageDataSchema>;

/** Response to mail peek request */
export const MailPeekResponseSchema = z.object({
  success: z.boolean(),
  message: MailMessageDataSchema.optional(),
  error: z.string().optional(),
});
export type MailPeekResponse = z.infer<typeof MailPeekResponseSchema>;

// =============================================================================
// Archive
// =============================================================================

/** Request to archive mail messages */
export const MailArchiveRequestSchema = z.object({
  userId: z.number(),
  messageIds: z.array(z.number()),
});
export type MailArchiveRequest = z.infer<typeof MailArchiveRequestSchema>;

/** Response to mail archive request */
export const MailArchiveResponseSchema = z.object({
  success: z.boolean(),
  archivedIds: z.array(z.number()).optional(),
  error: z.string().optional(),
});
export type MailArchiveResponse = z.infer<typeof MailArchiveResponseSchema>;

// =============================================================================
// Search
// =============================================================================

/** Request to search mail messages */
export const MailSearchRequestSchema = z.object({
  userId: z.number(),
  terms: z.string(),
  includeArchived: z.boolean().optional(),
  subjectOnly: z.boolean().optional(),
});
export type MailSearchRequest = z.infer<typeof MailSearchRequestSchema>;

/** A single message in a mail search response */
export const MailSearchMessageDataSchema = z.object({
  id: z.number(),
  subject: z.string(),
  fromUsername: z.string(),
  createdAt: z.string(),
});
export type MailSearchMessageData = z.infer<typeof MailSearchMessageDataSchema>;

/** Response to mail search request */
export const MailSearchResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(MailSearchMessageDataSchema).optional(),
  error: z.string().optional(),
});
export type MailSearchResponse = z.infer<typeof MailSearchResponseSchema>;

// =============================================================================
// Mark Read
// =============================================================================

/** Request to mark messages as read */
export const MailMarkReadRequestSchema = z.object({
  userId: z.number(),
  messageIds: z.array(z.number()),
});
export type MailMarkReadRequest = z.infer<typeof MailMarkReadRequestSchema>;

/** Response to mark-read request */
export const MailMarkReadResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type MailMarkReadResponse = z.infer<typeof MailMarkReadResponseSchema>;

// =============================================================================
// Unread
// =============================================================================

/** Request to get unread messages */
export const MailUnreadRequestSchema = z.object({
  userId: z.number(),
  kind: MessageKindSchema,
  afterId: z.number().optional(),
});
export type MailUnreadRequest = z.infer<typeof MailUnreadRequestSchema>;

/** Response to unread messages request */
export const MailUnreadResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(MailMessageDataSchema).optional(),
  error: z.string().optional(),
});
export type MailUnreadResponse = z.infer<typeof MailUnreadResponseSchema>;

// =============================================================================
// Push notification
// =============================================================================

/** Push notification from hub to NAISYS when mail is received */
export const MailReceivedPushSchema = z.object({
  recipientUserIds: z.array(z.number()),
  kind: MessageKindSchema,
});
export type MailReceivedPush = z.infer<typeof MailReceivedPushSchema>;

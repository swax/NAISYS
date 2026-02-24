import { HateoasActionSchema } from "@naisys/common";
import { z } from "zod";

export const ChatConversationSchema = z.object({
  participantIds: z.string(),
  participantNames: z.array(z.string()),
  lastMessage: z.string(),
  lastMessageAt: z.string(),
  lastMessageFrom: z.string(),
});

export const ChatAttachmentSchema = z.object({
  id: z.number(),
  filename: z.string(),
  fileSize: z.number(),
});

export const ChatMessageSchema = z.object({
  id: z.number(),
  fromUserId: z.number(),
  fromUsername: z.string(),
  body: z.string(),
  createdAt: z.string(),
  attachments: z.array(ChatAttachmentSchema).optional(),
  readBy: z.array(z.number()).optional(), // user IDs who have read
});

export const ChatConversationsResponseSchema = z.object({
  success: z.boolean(),
  conversations: z.array(ChatConversationSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const ChatMessagesRequestSchema = z.object({
  updatedSince: z.string().optional(),
  page: z.coerce.number().optional().default(1),
  count: z.coerce.number().optional().default(50),
});

export const ChatMessagesResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(ChatMessageSchema),
  total: z.number().optional(),
  timestamp: z.string(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const SendChatRequestSchema = z
  .object({
    fromId: z.number(),
    toIds: z.array(z.number()),
    message: z.string(),
  })
  .strict();

export const SendChatResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// Inferred types
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;
export type ChatConversation = z.infer<typeof ChatConversationSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatConversationsResponse = z.infer<
  typeof ChatConversationsResponseSchema
>;
export type ChatMessagesRequest = z.infer<typeof ChatMessagesRequestSchema>;
export type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>;
export type SendChatRequest = z.infer<typeof SendChatRequestSchema>;
export type SendChatResponse = z.infer<typeof SendChatResponseSchema>;

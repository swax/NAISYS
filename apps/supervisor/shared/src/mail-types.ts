import { HateoasActionSchema, HateoasLinkSchema } from "@naisys/common";
import { z } from "zod";

// Zod schemas for the new flat message model
export const MailRecipientSchema = z.object({
  userId: z.number(),
  username: z.string(),
  type: z.string(), // "to", "cc", "bcc"
});

export const MailAttachmentSchema = z.object({
  id: z.number(),
  filename: z.string(),
  fileSize: z.number(),
});

export const MailMessageSchema = z.object({
  id: z.number(),
  fromUserId: z.number(),
  fromUsername: z.string(),
  subject: z.string(),
  body: z.string(),
  createdAt: z.string(),
  recipients: z.array(MailRecipientSchema),
  attachments: z.array(MailAttachmentSchema).optional(),
});

export const SendMailRequestSchema = z
  .object({
    fromId: z.number(),
    toId: z.number(),
    subject: z.string(),
    message: z.string(),
  })
  .strict();

export const SendMailResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  messageId: z.number().optional(),
});

export const MailDataRequestSchema = z.object({
  updatedSince: z.string().optional(),
  page: z.coerce.number().optional().default(1),
  count: z.coerce.number().optional().default(50),
});

export const MailDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      mail: z.array(MailMessageSchema),
      timestamp: z.string(),
      total: z.number().optional(),
    })
    .optional(),
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

// Inferred types
export type MailAttachment = z.infer<typeof MailAttachmentSchema>;
export type MailRecipient = z.infer<typeof MailRecipientSchema>;
export type MailMessage = z.infer<typeof MailMessageSchema>;
export type SendMailRequest = z.infer<typeof SendMailRequestSchema>;
export type SendMailResponse = z.infer<typeof SendMailResponseSchema>;
export type MailDataRequest = z.infer<typeof MailDataRequestSchema>;
export type MailDataResponse = z.infer<typeof MailDataResponseSchema>;

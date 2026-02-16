import { z } from "zod";

// Zod schemas for the new flat message model
export const MailRecipientSchema = z.object({
  userId: z.number(),
  username: z.string(),
  type: z.string(), // "to", "cc", "bcc"
});

export const MailMessageSchema = z.object({
  id: z.number(),
  fromUserId: z.number(),
  fromUsername: z.string(),
  subject: z.string(),
  body: z.string(),
  createdAt: z.string(),
  recipients: z.array(MailRecipientSchema),
});

export const SendMailRequestSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    subject: z.string(),
    message: z.string(),
    attachments: z
      .array(
        z.object({
          filename: z.string(),
          data: z.instanceof(Buffer),
        }),
      )
      .optional(),
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
});

// Inferred types
export type MailRecipient = z.infer<typeof MailRecipientSchema>;
export type MailMessage = z.infer<typeof MailMessageSchema>;
export type SendMailRequest = z.infer<typeof SendMailRequestSchema>;
export type SendMailResponse = z.infer<typeof SendMailResponseSchema>;
export type MailDataRequest = z.infer<typeof MailDataRequestSchema>;
export type MailDataResponse = z.infer<typeof MailDataResponseSchema>;

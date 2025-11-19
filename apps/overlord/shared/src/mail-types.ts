import { z } from "zod";

// Zod schemas
export const ThreadMemberSchema = z.object({
  userId: z.number(),
  username: z.string(),
  newMsgId: z.number(),
  archived: z.boolean(),
});

export const ThreadMessageSchema = z.object({
  id: z.number(),
  threadId: z.number(),
  userId: z.number(),
  username: z.string(),
  subject: z.string(),
  message: z.string(),
  date: z.string(),
  members: z.array(ThreadMemberSchema),
});

export const SendMailRequestSchema = z.object({
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
});

export const SendMailResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  messageId: z.number().optional(),
});

export const MailDataRequestSchema = z.object({
  agentName: z.string(),
  updatedSince: z.string().optional(),
  page: z.coerce.number().optional().default(1),
  count: z.coerce.number().optional().default(50),
});

export const MailDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      mail: z.array(ThreadMessageSchema),
      timestamp: z.string(),
      total: z.number().optional(),
    })
    .optional(),
});

// Inferred types
export type ThreadMember = z.infer<typeof ThreadMemberSchema>;
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;
export type SendMailRequest = z.infer<typeof SendMailRequestSchema>;
export type SendMailResponse = z.infer<typeof SendMailResponseSchema>;
export type MailDataRequest = z.infer<typeof MailDataRequestSchema>;
export type MailDataResponse = z.infer<typeof MailDataResponseSchema>;

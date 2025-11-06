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

// Inferred types
export type ThreadMember = z.infer<typeof ThreadMemberSchema>;
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;
export type SendMailRequest = z.infer<typeof SendMailRequestSchema>;
export type SendMailResponse = z.infer<typeof SendMailResponseSchema>;

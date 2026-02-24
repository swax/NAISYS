import { z } from "zod";

// Zod schemas
export const LogSourceSchema = z.enum([
  "startPrompt",
  "endPrompt",
  "console",
  "llm",
  "",
]);
export const LogTypeSchema = z.enum([
  "comment",
  "error",
  "system",
  "workspace",
  "",
]);
export const LogRoleSchema = z.enum(["NAISYS", "LLM"]);

export const LogAttachmentSchema = z.object({
  id: z.number(),
  filename: z.string(),
  fileSize: z.number(),
});

export const LogEntrySchema = z.object({
  id: z.number(),
  username: z.string(),
  role: LogRoleSchema,
  source: LogSourceSchema,
  type: LogTypeSchema,
  message: z.string(),
  createdAt: z.string(),
  attachment: LogAttachmentSchema.optional(),
});

// Inferred types
export type LogAttachment = z.infer<typeof LogAttachmentSchema>;
export type LogSource = z.infer<typeof LogSourceSchema>;
export type LogType = z.infer<typeof LogTypeSchema>;
export type LogRole = z.infer<typeof LogRoleSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;

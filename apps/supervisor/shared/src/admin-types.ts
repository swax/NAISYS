import { HateoasActionSchema, HateoasLinkSchema } from "@naisys/common";
import { z } from "zod";

export const AdminInfoResponseSchema = z.object({
  supervisorDbPath: z.string(),
  supervisorDbSize: z.number().optional(),
  hubDbPath: z.string(),
  hubDbSize: z.number().optional(),
  hubConnected: z.boolean(),
  hubAccessKey: z.string().optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type AdminInfoResponse = z.infer<typeof AdminInfoResponseSchema>;

export const AdminAttachmentItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  fileSize: z.number(),
  fileHash: z.string(),
  purpose: z.string(),
  uploadedBy: z.string(),
  createdAt: z.string(),
});
export type AdminAttachmentItem = z.infer<typeof AdminAttachmentItemSchema>;

export const AdminAttachmentListRequestSchema = z.object({
  page: z.coerce.number().optional().default(1),
  pageSize: z.coerce.number().optional().default(50),
});
export type AdminAttachmentListRequest = z.infer<
  typeof AdminAttachmentListRequestSchema
>;

export const AdminAttachmentListResponseSchema = z.object({
  attachments: z.array(AdminAttachmentItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
});
export type AdminAttachmentListResponse = z.infer<
  typeof AdminAttachmentListResponseSchema
>;

export const RotateAccessKeyResultSchema = z.object({
  success: z.boolean(),
  newAccessKey: z.string().optional(),
  error: z.string().optional(),
});
export type RotateAccessKeyResult = z.infer<typeof RotateAccessKeyResultSchema>;

export const ServerLogFileSchema = z.enum([
  "supervisor",
  "hub-server",
  "hub-client",
]);
export type ServerLogFile = z.infer<typeof ServerLogFileSchema>;

export const ServerLogRequestSchema = z.object({
  file: ServerLogFileSchema,
  lines: z.coerce.number().optional().default(200),
  minLevel: z.coerce.number().optional(),
});
export type ServerLogRequest = z.infer<typeof ServerLogRequestSchema>;

export const PinoLogEntrySchema = z.object({
  level: z.number(),
  time: z.number(),
  msg: z.string(),
  detail: z.string().optional(),
});
export type PinoLogEntry = z.infer<typeof PinoLogEntrySchema>;

export const ServerLogResponseSchema = z.object({
  entries: z.array(PinoLogEntrySchema),
  fileName: z.string(),
  fileSize: z.number().optional(),
});
export type ServerLogResponse = z.infer<typeof ServerLogResponseSchema>;

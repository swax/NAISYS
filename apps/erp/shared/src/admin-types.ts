import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const AdminInfoResponseSchema = z.object({
  erpVersion: z.string(),
  erpDbPath: z.string(),
  erpDbSize: z.number().optional(),
  erpDbVersion: z.number(),
  targetVersion: z.string().optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const AdminAttachmentItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  fileSize: z.number(),
  fileHash: z.string(),
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

export type AdminInfoResponse = z.infer<typeof AdminInfoResponseSchema>;

export const PinoLogEntrySchema = z.object({
  level: z.number(),
  time: z.number(),
  msg: z.string(),
  detail: z.string().optional(),
});
export type PinoLogEntry = z.infer<typeof PinoLogEntrySchema>;

export const ServerLogRequestSchema = z.object({
  lines: z.coerce.number().optional().default(200),
  minLevel: z.coerce.number().optional(),
});
export type ServerLogRequest = z.infer<typeof ServerLogRequestSchema>;

export const ServerLogResponseSchema = z.object({
  entries: z.array(PinoLogEntrySchema),
  fileName: z.string(),
  fileSize: z.number().optional(),
});
export type ServerLogResponse = z.infer<typeof ServerLogResponseSchema>;

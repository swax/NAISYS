import { HateoasActionSchema, HateoasLinkSchema } from "@naisys/common";
import { z } from "zod";

export const AdminInfoResponseSchema = z.object({
  supervisorVersion: z.string(),
  supervisorDbPath: z.string(),
  supervisorDbSize: z.number().optional(),
  supervisorDbVersion: z.number(),
  hubVersion: z.string(),
  hubDbPath: z.string(),
  hubDbSize: z.number().optional(),
  hubDbVersion: z.number(),
  hubConnected: z.boolean(),
  hubAccessKey: z.string().optional(),
  targetVersion: z.string().optional(),
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

// --- NPM version check types ---

export const NpmVersionsRequestSchema = z.object({
  check: z.string().optional(),
});
export type NpmVersionsRequest = z.infer<typeof NpmVersionsRequestSchema>;

export const NpmVersionsResponseSchema = z.object({
  latest: z.string(),
  beta: z.string().nullable(),
  targetVersion: z.string(),
  check: z
    .object({
      version: z.string(),
      exists: z.boolean(),
    })
    .optional(),
});
export type NpmVersionsResponse = z.infer<typeof NpmVersionsResponseSchema>;

// Empty clears the target. Otherwise:
//   <npm>           e.g. "1.2.3" or "1.2.3-beta.1"  (npm clients pin to exact version)
//   >=<npm>         e.g. ">=1.2.3"                  (npm clients: this version or newer)
//   <npm>/<hash>    npm + git spec bundled          (npm clients use <npm>, git clients use <hash>)
//   >=<npm>/<hash>  same, with range on npm part
//   /<hash>         git clients only
// The ">=" operator only affects the npm part; git clients always compare hash exactly.
const TARGET_VERSION_PATTERN =
  /^$|^(>=)?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\/[0-9a-f]{40})?$|^\/[0-9a-f]{40}$/;

export const SetTargetVersionRequestSchema = z.object({
  version: z
    .string()
    .regex(TARGET_VERSION_PATTERN, "Invalid target version format"),
});
export type SetTargetVersionRequest = z.infer<
  typeof SetTargetVersionRequestSchema
>;

import { z } from "zod/v4";

export const AuditEntrySchema = z.object({
  id: z.number(),
  entityType: z.string(),
  entityId: z.number(),
  action: z.string(),
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  userId: z.number(),
  createdAt: z.iso.datetime(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditListResponseSchema = z.object({
  items: z.array(AuditEntrySchema),
});

export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

export const AuditQuerySchema = z.object({
  entityType: z.string(),
  entityId: z.coerce.number().int(),
});

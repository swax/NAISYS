import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const RevisionStatusEnum = z.enum(["draft", "approved", "obsolete"]);
export type RevisionStatus = z.infer<typeof RevisionStatusEnum>;
export const RevisionStatus = RevisionStatusEnum.enum;

// Full revision response shape
export const OrderRevisionSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  revNo: z.number(),
  status: RevisionStatusEnum,
  notes: z.string().nullable(),
  changeSummary: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderRevision = z.infer<typeof OrderRevisionSchema>;

// Input for creating a revision
export const CreateOrderRevisionSchema = z
  .object({
    notes: z.string().max(2000).optional(),
    changeSummary: z.string().max(2000).optional(),
  })
  .strict();

export type CreateOrderRevision = z.infer<typeof CreateOrderRevisionSchema>;

// Input for updating a revision
export const UpdateOrderRevisionSchema = z
  .object({
    notes: z.string().max(2000).optional(),
    changeSummary: z.string().max(2000).optional(),
  })
  .strict();

export type UpdateOrderRevision = z.infer<typeof UpdateOrderRevisionSchema>;

// Query params for listing revisions
export const OrderRevisionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: RevisionStatusEnum.optional(),
});

export type OrderRevisionListQuery = z.infer<
  typeof OrderRevisionListQuerySchema
>;

// List response
export const OrderRevisionListResponseSchema = z.object({
  items: z.array(OrderRevisionSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderRevisionListResponse = z.infer<
  typeof OrderRevisionListResponseSchema
>;

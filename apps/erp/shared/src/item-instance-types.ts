import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// Full item instance response shape
export const ItemInstanceSchema = z.object({
  id: z.number(),
  itemKey: z.string(),
  orderRunKey: z.string().nullable(),
  key: z.string(),
  quantity: z.number().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedBy: z.string(),
  updatedAt: z.iso.datetime(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type ItemInstance = z.infer<typeof ItemInstanceSchema>;

// Input for creating an item instance
export const CreateItemInstanceSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(200),
    quantity: z.number().nullable().optional(),
    orderRunId: z.number().nullable().optional(),
  })
  .strict();

export type CreateItemInstance = z.infer<typeof CreateItemInstanceSchema>;

// Input for updating an item instance
export const UpdateItemInstanceSchema = z
  .object({
    key: z.string().min(1).max(200).optional(),
    quantity: z.number().nullable().optional(),
    orderRunId: z.number().nullable().optional(),
  })
  .strict();

export type UpdateItemInstance = z.infer<typeof UpdateItemInstanceSchema>;

// Query params for listing item instances
export const ItemInstanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional(),
});

export type ItemInstanceListQuery = z.infer<typeof ItemInstanceListQuerySchema>;

// List response
export const ItemInstanceListResponseSchema = z.object({
  items: z.array(ItemInstanceSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type ItemInstanceListResponse = z.infer<
  typeof ItemInstanceListResponseSchema
>;

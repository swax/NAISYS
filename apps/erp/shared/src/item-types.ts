import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// Full item response shape
export const ItemSchema = z.object({
  id: z.number(),
  key: z.string(),
  description: z.string(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedBy: z.string(),
  updatedAt: z.iso.datetime(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type Item = z.infer<typeof ItemSchema>;

// Input for creating an item
export const CreateItemSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/,
        "Key must be alphanumeric with hyphens",
      ),
    description: z.string().max(2000).optional().default(""),
  })
  .strict();

export type CreateItem = z.infer<typeof CreateItemSchema>;

// Input for updating an item
export const UpdateItemSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/,
        "Key must be alphanumeric with hyphens",
      )
      .optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

export type UpdateItem = z.infer<typeof UpdateItemSchema>;

// Query params for listing items
export const ItemListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional(),
});

export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

// List response
export const ItemListResponseSchema = z.object({
  items: z.array(ItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;

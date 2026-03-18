import { z } from "zod/v4";

import {
  HateoasActionTemplateSchema,
  HateoasLinkSchema,
} from "./hateoas-types.js";

// Query params for inventory list (all item instances across all items)
export const InventoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional(),
});

export type InventoryListQuery = z.infer<typeof InventoryListQuerySchema>;

// Flattened inventory item for the list
export const InventoryItemSchema = z.object({
  id: z.number(),
  itemKey: z.string(),
  key: z.string(),
  quantity: z.number().nullable(),
  orderKey: z.string().nullable(),
  orderRunNo: z.number().nullable(),
  createdAt: z.iso.datetime(),
});

export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const InventoryListResponseSchema = z.object({
  items: z.array(InventoryItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type InventoryListResponse = z.infer<typeof InventoryListResponseSchema>;

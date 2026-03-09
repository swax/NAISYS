import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// Full order response shape
export const OrderSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  createdBy: z.number(),
  createdAt: z.iso.datetime(),
  updatedBy: z.number(),
  updatedAt: z.iso.datetime(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type Order = z.infer<typeof OrderSchema>;

// Input for creating an order
export const CreateOrderSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        "Key must be lowercase alphanumeric with hyphens",
      ),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional().default(""),
  })
  .strict();

export type CreateOrder = z.infer<typeof CreateOrderSchema>;

// Input for updating an order
export const UpdateOrderSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict();

export type UpdateOrder = z.infer<typeof UpdateOrderSchema>;

// Query params for listing orders
export const OrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(["active", "archived"]).optional(),
  search: z.string().optional(),
});

export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

// List response
export const OrderListResponseSchema = z.object({
  items: z.array(OrderSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderListResponse = z.infer<typeof OrderListResponseSchema>;

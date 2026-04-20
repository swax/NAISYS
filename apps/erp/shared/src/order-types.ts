import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "./hateoas-types.js";
import { paginationQuery } from "./pagination-types.js";

export const OrderStatusEnum = z.enum(["active", "archived"]);
export type OrderStatus = z.infer<typeof OrderStatusEnum>;
export const OrderStatus = OrderStatusEnum.enum;

// Full order response shape
export const OrderSchema = z.object({
  id: z.number(),
  key: z.string(),
  description: z.string(),
  status: OrderStatusEnum,
  itemKey: z.string().nullable(),
  latestApprovedRevNo: z.number().int().nullable().optional(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedBy: z.string(),
  updatedAt: z.iso.datetime(),
  _links: z.array(HateoasLinkSchema).optional(),
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
        /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/,
        "Key must be alphanumeric with hyphens",
      ),
    description: z.string().max(2000).optional().default(""),
    itemKey: z.string().max(100).optional(),
  })
  .strict();

export type CreateOrder = z.infer<typeof CreateOrderSchema>;

// Input for updating an order
export const UpdateOrderSchema = z
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
    status: OrderStatusEnum.optional(),
    itemKey: z.string().max(100).nullable().optional(),
  })
  .strict();

export type UpdateOrder = z.infer<typeof UpdateOrderSchema>;

// Query params for listing orders
export const OrderListQuerySchema = z.object({
  ...paginationQuery(),
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
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderListResponse = z.infer<typeof OrderListResponseSchema>;

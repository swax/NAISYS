import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const OrderRunStatusEnum = z.enum([
  "released",
  "started",
  "closed",
  "cancelled",
]);
export type OrderRunStatus = z.infer<typeof OrderRunStatusEnum>;

export const OrderRunPriorityEnum = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type OrderRunPriority = z.infer<typeof OrderRunPriorityEnum>;

// Full order run response shape
export const OrderRunSchema = z.object({
  id: z.number(),
  runNo: z.number(),
  orderId: z.number(),
  orderKey: z.string(),
  revNo: z.number(),
  status: OrderRunStatusEnum,
  priority: OrderRunPriorityEnum,
  scheduledStartAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  releasedAt: z.iso.datetime(),
  assignedTo: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderRun = z.infer<typeof OrderRunSchema>;

// Input for creating an order run
export const CreateOrderRunSchema = z
  .object({
    revNo: z.number().int().min(1),
    priority: OrderRunPriorityEnum.optional().default("medium"),
    scheduledStartAt: z.iso.datetime().optional(),
    dueAt: z.iso.datetime().optional(),
    assignedTo: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type CreateOrderRun = z.infer<typeof CreateOrderRunSchema>;

// Input for updating an order run
export const UpdateOrderRunSchema = z
  .object({
    priority: OrderRunPriorityEnum.optional(),
    scheduledStartAt: z.iso.datetime().nullable().optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    assignedTo: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export type UpdateOrderRun = z.infer<typeof UpdateOrderRunSchema>;

// Query params for listing order runs
export const OrderRunListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: OrderRunStatusEnum.optional(),
  priority: OrderRunPriorityEnum.optional(),
  search: z.string().optional(),
});

export type OrderRunListQuery = z.infer<typeof OrderRunListQuerySchema>;

// List response
export const OrderRunListResponseSchema = z.object({
  items: z.array(OrderRunSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderRunListResponse = z.infer<typeof OrderRunListResponseSchema>;

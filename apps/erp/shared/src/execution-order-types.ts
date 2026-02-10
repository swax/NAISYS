import { z } from "zod/v4";
import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const ExecutionOrderStatusEnum = z.enum([
  "released",
  "started",
  "closed",
  "cancelled",
]);
export type ExecutionOrderStatus = z.infer<typeof ExecutionOrderStatusEnum>;

export const ExecutionOrderPriorityEnum = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type ExecutionOrderPriority = z.infer<typeof ExecutionOrderPriorityEnum>;

// Full execution order response shape
export const ExecutionOrderSchema = z.object({
  id: z.number(),
  orderNo: z.number(),
  planOrderId: z.number(),
  planOrderRevId: z.number(),
  status: ExecutionOrderStatusEnum,
  priority: ExecutionOrderPriorityEnum,
  scheduledStartAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  releasedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  assignedTo: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.number(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type ExecutionOrder = z.infer<typeof ExecutionOrderSchema>;

// Input for creating an execution order
export const CreateExecutionOrderSchema = z.object({
  planOrderId: z.number().int().min(1),
  planOrderRevId: z.number().int().min(1),
  priority: ExecutionOrderPriorityEnum.optional().default("medium"),
  scheduledStartAt: z.iso.datetime().optional(),
  dueAt: z.iso.datetime().optional(),
  assignedTo: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  createdBy: z.number().int(),
});

export type CreateExecutionOrder = z.infer<typeof CreateExecutionOrderSchema>;

// Input for updating an execution order
export const UpdateExecutionOrderSchema = z.object({
  priority: ExecutionOrderPriorityEnum.optional(),
  scheduledStartAt: z.iso.datetime().nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  assignedTo: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  updatedBy: z.number().int(),
});

export type UpdateExecutionOrder = z.infer<typeof UpdateExecutionOrderSchema>;

// Query params for listing execution orders
export const ExecutionOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: ExecutionOrderStatusEnum.optional(),
  priority: ExecutionOrderPriorityEnum.optional(),
  search: z.string().optional(),
});

export type ExecutionOrderListQuery = z.infer<
  typeof ExecutionOrderListQuerySchema
>;

// List response
export const ExecutionOrderListResponseSchema = z.object({
  items: z.array(ExecutionOrderSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type ExecutionOrderListResponse = z.infer<
  typeof ExecutionOrderListResponseSchema
>;

import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasActionTemplateSchema,
  HateoasLinkSchema,
} from "./hateoas-types.js";
import { OperationRunStatusEnum } from "./operation-run-types.js";

export const OrderRunStatusEnum = z.enum([
  "released",
  "started",
  "closed",
  "cancelled",
]);
export type OrderRunStatus = z.infer<typeof OrderRunStatusEnum>;
export const OrderRunStatus = OrderRunStatusEnum.enum;

export const OrderRunPriorityEnum = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type OrderRunPriority = z.infer<typeof OrderRunPriorityEnum>;
export const OrderRunPriority = OrderRunPriorityEnum.enum;

// Full order run response shape
export const OrderRunSchema = z.object({
  id: z.number(),
  runNo: z.number(),
  orderId: z.number(),
  orderKey: z.string(),
  revNo: z.number(),
  itemKey: z.string().nullable(),
  instanceId: z.number().nullable(),
  instanceKey: z.string().nullable(),
  status: OrderRunStatusEnum,
  priority: OrderRunPriorityEnum,
  cost: z.number().nullable(),
  scheduledStartAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
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

// Input for completing an order run (creates item instance + closes run)
export const CompleteOrderRunSchema = z
  .object({
    instanceKey: z.string().max(200).optional(),
    quantity: z.number().nullable().optional(),
    fieldValues: z
      .array(
        z.object({
          fieldId: z.number().int(),
          value: z.string().max(2000),
          setIndex: z.number().int().min(0).optional(),
        }),
      )
      .optional(),
  })
  .strict();

export type CompleteOrderRun = z.infer<typeof CompleteOrderRunSchema>;

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

// Query params for dispatch view (operation runs across open orders)
export const DispatchListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: OperationRunStatusEnum.optional(),
  priority: OrderRunPriorityEnum.optional(),
  search: z.string().optional(),
  clockedIn: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
});

export type DispatchListQuery = z.infer<typeof DispatchListQuerySchema>;

// Dispatch item = operation run with parent order/run context
export const DispatchItemSchema = z.object({
  id: z.number(),
  orderKey: z.string(),
  revNo: z.number(),
  runNo: z.number(),
  seqNo: z.number(),
  title: z.string(),
  status: OperationRunStatusEnum,
  priority: OrderRunPriorityEnum,
  assignedTo: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type DispatchItem = z.infer<typeof DispatchItemSchema>;

export const DispatchListResponseSchema = z.object({
  items: z.array(DispatchItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type DispatchListResponse = z.infer<typeof DispatchListResponseSchema>;

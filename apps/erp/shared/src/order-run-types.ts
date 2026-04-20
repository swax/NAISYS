import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasActionTemplateSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "./hateoas-types.js";
import { OperationRunStatusEnum } from "./operation-run-types.js";
import { paginationQuery } from "./pagination-types.js";

// Operation summary embedded in order run GET responses
export const OperationRunSummarySchema = z.object({
  seqNo: z.number(),
  title: z.string(),
  status: OperationRunStatusEnum,
});

export type OperationRunSummary = z.infer<typeof OperationRunSummarySchema>;

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
  description: z.string(),
  itemKey: z.string().nullable(),
  instanceId: z.number().nullable(),
  instanceKey: z.string().nullable(),
  status: OrderRunStatusEnum,
  priority: OrderRunPriorityEnum,
  cost: z.number().nullable(),
  dueAt: z.string().nullable(),
  releaseNote: z.string().nullable(),
  operationSummary: z.array(OperationRunSummarySchema).optional(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderRun = z.infer<typeof OrderRunSchema>;

// Input for creating an order run
export const CreateOrderRunSchema = z
  .object({
    revNo: z.number().int().min(1).optional(),
    priority: OrderRunPriorityEnum.optional().default("medium"),
    dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
    releaseNote: z.string().max(2000).optional(),
  })
  .strict();

export type CreateOrderRun = z.infer<typeof CreateOrderRunSchema>;

// Input for updating an order run
export const UpdateOrderRunSchema = z
  .object({
    priority: OrderRunPriorityEnum.optional(),
    dueAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .nullable()
      .optional(),
    releaseNote: z.string().max(2000).nullable().optional(),
  })
  .strict();

export type UpdateOrderRun = z.infer<typeof UpdateOrderRunSchema>;

// Input for completing an order run (creates item instance + closes run).
// `fieldValues[].fieldSeqNo` is the per-item field sequence number — matches
// the field-update endpoint at /items/{key}/instances/{instanceId}/fields/{fieldSeqNo}.
// If any required item field is empty, the endpoint returns 400 with the
// missing field labels rather than creating an invalid instance.
export const CompleteOrderRunSchema = z
  .object({
    instanceKey: z.string().max(200).optional(),
    quantity: z.number().nullable().optional(),
    fieldValues: z
      .array(
        z.object({
          fieldSeqNo: z.number().int(),
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
  ...paginationQuery(),
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
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OrderRunListResponse = z.infer<typeof OrderRunListResponseSchema>;

// Query params for dispatch view (operation runs across open orders)
export const DispatchListQuerySchema = z.object({
  ...paginationQuery(),
  status: OperationRunStatusEnum.optional(),
  priority: OrderRunPriorityEnum.optional(),
  search: z.string().optional(),
  viewAs: z.string().optional(),
  canWork: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
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
  workCenterKey: z.string().nullable(),
  canWork: z.boolean(),
  status: OperationRunStatusEnum,
  priority: OrderRunPriorityEnum,
  assignedTo: z.string().nullable(),
  dueAt: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type DispatchItem = z.infer<typeof DispatchItemSchema>;

export const DispatchListResponseSchema = z.object({
  items: z.array(DispatchItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type DispatchListResponse = z.infer<typeof DispatchListResponseSchema>;

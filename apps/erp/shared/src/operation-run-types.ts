import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";
import { OperationPredecessorSchema } from "./operation-types.js";

export const OperationRunStatusEnum = z.enum([
  "blocked",
  "pending",
  "in_progress",
  "completed",
  "skipped",
  "failed",
]);
export type OperationRunStatus = z.infer<typeof OperationRunStatusEnum>;
export const OperationRunStatus = OperationRunStatusEnum.enum;

// Full operation run response shape
export const OperationRunSchema = z.object({
  id: z.number(),
  orderRunId: z.number(),
  operationId: z.number(),
  seqNo: z.number(),
  title: z.string(),
  description: z.string(),
  stepCount: z.number().optional(),
  predecessors: z.array(OperationPredecessorSchema).optional(),
  status: OperationRunStatusEnum,
  cost: z.number().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationRun = z.infer<typeof OperationRunSchema>;

// Input for updating an operation run
export const UpdateOperationRunSchema = z.object({}).strict();

export type UpdateOperationRun = z.infer<typeof UpdateOperationRunSchema>;

// List response
export const OperationRunListResponseSchema = z.object({
  items: z.array(OperationRunSchema),
  total: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationRunListResponse = z.infer<
  typeof OperationRunListResponseSchema
>;

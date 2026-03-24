import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";
import { OperationPredecessorSchema } from "./operation-types.js";

// Step summary embedded in operation run GET responses
export const StepRunSummarySchema = z.object({
  seqNo: z.number(),
  title: z.string(),
  completed: z.boolean(),
});

export type StepRunSummary = z.infer<typeof StepRunSummarySchema>;

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
  workCenterKey: z.string().nullable(),
  stepCount: z.number().optional(),
  predecessors: z.array(OperationPredecessorSchema).optional(),
  status: OperationRunStatusEnum,
  assignedTo: z.string().nullable(),
  cost: z.number().nullable(),
  note: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  stepSummary: z.array(StepRunSummarySchema).optional(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationRun = z.infer<typeof OperationRunSchema>;

// Input for updating an operation run
export const UpdateOperationRunSchema = z
  .object({
    assignedToId: z.number().int().nullable().optional(),
  })
  .strict();

export type UpdateOperationRun = z.infer<typeof UpdateOperationRunSchema>;

// Body for any status transition that accepts an optional note
export const TransitionNoteSchema = z
  .object({
    note: z.string().max(2000).optional(),
  })
  .strict();

export type TransitionNote = z.infer<typeof TransitionNoteSchema>;

// Slim transition response (start/complete/skip/fail/reopen)
export const OperationRunTransitionSchema = z.object({
  id: z.number(),
  status: OperationRunStatusEnum,
  assignedTo: z.string().nullable(),
  cost: z.number().nullable(),
  note: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationRunTransition = z.infer<
  typeof OperationRunTransitionSchema
>;

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

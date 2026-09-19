import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "../hateoas-types.js";
import { FieldRefValueSummarySchema } from "../production/field-ref-types.js";
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
  revNo: z.number(),
  orderDescription: z.string(),
  seqNo: z.number(),
  title: z.string(),
  description: z.string(),
  workCenterKey: z.string().nullable(),
  stepCount: z.number().optional(),
  predecessors: z.array(OperationPredecessorSchema).optional(),
  status: OperationRunStatusEnum,
  assignedTo: z.string().nullable(),
  assignedToTitle: z.string().nullable(),
  cost: z.number().nullable(),
  tokens: z.number().nullable(),
  note: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  retryNotBefore: z.iso.datetime().nullable().optional(),
  retryWakeSentAt: z.iso.datetime().nullable().optional(),
  stepSummary: z.array(StepRunSummarySchema).optional(),
  fieldRefSummary: z.array(FieldRefValueSummarySchema).optional(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  createdByTitle: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  updatedByTitle: z.string(),
  _links: z.array(HateoasLinkSchema).optional(),
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
// Accept null/undefined so callers don't need to send -d '{}' on POST
// endpoints where the body is entirely optional. A simpler
// .nullable().default({}) doesn't narrow the output type in zod v4,
// so we normalize a nullish input instead. Avoid an explicit undefined union:
// undefined has no JSON representation and breaks schema discovery.
const transitionNoteText = z
  .string()
  .max(
    2000,
    "Keep transition notes within 2000 characters; put detailed evidence in comments or attachments.",
  )
  .describe(
    "Short status summary, at most 2000 characters. Put full evidence in operation comments/attachments.",
  );

export const TransitionNoteSchema = z
  .object({ note: transitionNoteText.optional() })
  .strict()
  .nullish()
  .transform((v) => v ?? {});

export type TransitionNote = z.infer<typeof TransitionNoteSchema>;

// A timed external blocker remains failed until its manager explicitly reopens it.
export const FailOperationRunSchema = z
  .object({
    note: transitionNoteText.optional(),
    retryNotBefore: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .nullish()
  .transform((value) => value ?? {});

// Slim transition response (start/complete/skip/fail/reopen)
export const OperationRunTransitionSchema = z.object({
  id: z.number(),
  status: OperationRunStatusEnum,
  assignedTo: z.string().nullable(),
  assignedToTitle: z.string().nullable(),
  cost: z.number().nullable(),
  tokens: z.number().nullable(),
  note: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  retryNotBefore: z.iso.datetime().nullable().optional(),
  retryWakeSentAt: z.iso.datetime().nullable().optional(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  updatedByTitle: z.string(),
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
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationRunListResponse = z.infer<
  typeof OperationRunListResponseSchema
>;

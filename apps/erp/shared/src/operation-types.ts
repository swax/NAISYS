import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "./hateoas-types.js";

// Predecessor summary (included in list responses)
export const OperationPredecessorSchema = z.object({
  seqNo: z.number(),
  title: z.string(),
});

// Step summary (included in single operation GET responses)
export const StepSummarySchema = z.object({
  seqNo: z.number(),
  title: z.string(),
});

export type OperationPredecessor = z.infer<typeof OperationPredecessorSchema>;

// Full operation response shape
export const OperationSchema = z.object({
  id: z.number(),
  orderRevId: z.number(),
  seqNo: z.number(),
  title: z.string(),
  description: z.string(),
  workCenterKey: z.string().nullable(),
  stepCount: z.number().optional(),
  stepSummary: z.array(StepSummarySchema).optional(),
  predecessors: z.array(OperationPredecessorSchema).optional(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type Operation = z.infer<typeof OperationSchema>;

// Input for creating an operation
export const CreateOperationSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    workCenterKey: z.string().max(100).nullable().optional(),
    predecessorSeqNos: z.array(z.number().int().min(1)).optional(),
  })
  .strict();

export type CreateOperation = z.infer<typeof CreateOperationSchema>;

// Input for updating an operation
export const UpdateOperationSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    workCenterKey: z.string().max(100).nullable().optional(),
    seqNo: z.number().int().min(1).optional(),
  })
  .strict();

export type UpdateOperation = z.infer<typeof UpdateOperationSchema>;

// List response
export const OperationListResponseSchema = z.object({
  items: z.array(OperationSchema),
  total: z.number(),
  nextSeqNo: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationListResponse = z.infer<typeof OperationListResponseSchema>;

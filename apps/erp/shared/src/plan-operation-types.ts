import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// Full plan operation response shape
export const PlanOperationSchema = z.object({
  id: z.number(),
  orderRevId: z.number(),
  seqNo: z.number(),
  title: z.string(),
  description: z.string(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type PlanOperation = z.infer<typeof PlanOperationSchema>;

// Input for creating an operation
export const CreatePlanOperationSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
  })
  .strict();

export type CreatePlanOperation = z.infer<typeof CreatePlanOperationSchema>;

// Input for updating an operation
export const UpdatePlanOperationSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    seqNo: z.number().int().min(1).optional(),
  })
  .strict();

export type UpdatePlanOperation = z.infer<typeof UpdatePlanOperationSchema>;

// List response
export const PlanOperationListResponseSchema = z.object({
  items: z.array(PlanOperationSchema),
  total: z.number(),
  nextSeqNo: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type PlanOperationListResponse = z.infer<
  typeof PlanOperationListResponseSchema
>;

import { z } from "zod/v4";

import { FieldListResponseSchema } from "./field-types.js";
import {
  HateoasActionSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "./hateoas-types.js";

// Full step response shape
export const StepSchema = z.object({
  id: z.number(),
  operationId: z.number(),
  seqNo: z.number(),
  title: z.string(),
  instructions: z.string(),
  multiSet: z.boolean(),
  fieldCount: z.number().optional(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  fields: FieldListResponseSchema,
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type Step = z.infer<typeof StepSchema>;

// Input for creating a step
export const CreateStepSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    title: z.string().max(200).optional(),
    instructions: z.string().max(10000).optional(),
    multiSet: z.boolean().optional(),
  })
  .strict();

export type CreateStep = z.infer<typeof CreateStepSchema>;

// Input for batch creating steps
export const BatchCreateStepSchema = z.object({
  items: z.array(CreateStepSchema).min(1).max(100),
});

export type BatchCreateStep = z.infer<typeof BatchCreateStepSchema>;

// Input for updating a step
export const UpdateStepSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    title: z.string().max(200).optional(),
    instructions: z.string().max(10000).optional(),
    multiSet: z.boolean().optional(),
  })
  .strict();

export type UpdateStep = z.infer<typeof UpdateStepSchema>;

// List response
export const StepListResponseSchema = z.object({
  items: z.array(StepSchema),
  total: z.number(),
  nextSeqNo: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type StepListResponse = z.infer<typeof StepListResponseSchema>;

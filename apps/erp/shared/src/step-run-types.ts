import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// A single field value within a step run
export const StepFieldValueSchema = z.object({
  stepFieldId: z.number(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
  value: z.string(),
});

export type StepFieldValue = z.infer<typeof StepFieldValueSchema>;

// Full step run response shape
export const StepRunSchema = z.object({
  id: z.number(),
  operationRunId: z.number(),
  stepId: z.number(),
  seqNo: z.number(),
  instructions: z.string(),
  completed: z.boolean(),
  fieldValues: z.array(StepFieldValueSchema),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type StepRun = z.infer<typeof StepRunSchema>;

// Batch update input — completed flag + field values
export const UpdateStepRunSchema = z
  .object({
    completed: z.boolean().optional(),
    fieldValues: z
      .array(
        z.object({
          stepFieldId: z.number().int(),
          value: z.string().max(2000),
        }),
      )
      .optional(),
  })
  .strict();

export type UpdateStepRun = z.infer<typeof UpdateStepRunSchema>;

// List response
export const StepRunListResponseSchema = z.object({
  items: z.array(StepRunSchema),
  total: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type StepRunListResponse = z.infer<typeof StepRunListResponseSchema>;

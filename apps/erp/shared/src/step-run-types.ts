import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// Validation result for a field value
export const StepFieldValidationSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
});

export type StepFieldValidation = z.infer<typeof StepFieldValidationSchema>;

// A single field value within a step run
export const StepFieldValueSchema = z.object({
  stepFieldId: z.number(),
  fieldSeqNo: z.number(),
  label: z.string(),
  type: z.string(),
  multiValue: z.boolean(),
  required: z.boolean(),
  value: z.string(),
  validation: StepFieldValidationSchema,
  _actions: z.array(HateoasActionSchema).optional(),
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

// Single field value update
export const UpdateStepFieldValueSchema = z
  .object({
    value: z.string().max(2000),
  })
  .strict();

export type UpdateStepFieldValue = z.infer<typeof UpdateStepFieldValueSchema>;

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

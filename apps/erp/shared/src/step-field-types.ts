import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const StepFieldTypeEnum = z.enum([
  "string",
  "number",
  "date",
  "datetime",
  "yesNo",
  "checkbox",
  "attachment",
]);
export type StepFieldType = z.infer<typeof StepFieldTypeEnum>;
export const StepFieldType = StepFieldTypeEnum.enum;

// Full step field response shape
export const StepFieldSchema = z.object({
  id: z.number(),
  stepId: z.number(),
  seqNo: z.number(),
  label: z.string(),
  type: StepFieldTypeEnum,
  multiValue: z.boolean(),
  required: z.boolean(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type StepField = z.infer<typeof StepFieldSchema>;

// Input for creating a step field
export const CreateStepFieldSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    label: z.string().min(1).max(200),
    type: StepFieldTypeEnum.optional(),
    multiValue: z.boolean().optional(),
    required: z.boolean().optional(),
  })
  .strict();

export type CreateStepField = z.infer<typeof CreateStepFieldSchema>;

// Input for updating a step field
export const UpdateStepFieldSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    label: z.string().min(1).max(200).optional(),
    type: StepFieldTypeEnum.optional(),
    multiValue: z.boolean().optional(),
    required: z.boolean().optional(),
  })
  .strict();

export type UpdateStepField = z.infer<typeof UpdateStepFieldSchema>;

// List response
export const StepFieldListResponseSchema = z.object({
  items: z.array(StepFieldSchema),
  total: z.number(),
  nextSeqNo: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type StepFieldListResponse = z.infer<typeof StepFieldListResponseSchema>;

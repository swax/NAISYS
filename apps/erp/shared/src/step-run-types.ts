import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasActionTemplateSchema,
  HateoasLinkSchema,
} from "./hateoas-types.js";

// Validation result for a field value
export const FieldValidationSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
});

export type FieldValidation = z.infer<typeof FieldValidationSchema>;

// Attachment metadata within a field value
export const FieldAttachmentSchema = z.object({
  id: z.number(),
  filename: z.string(),
  fileSize: z.number(),
});

export type FieldAttachment = z.infer<typeof FieldAttachmentSchema>;

// Field value: string for scalar fields, string[] for multiValue fields
export const FieldValueSchema = z.union([z.string(), z.array(z.string())]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

// A single field value entry (API response shape)
export const FieldValueEntrySchema = z.object({
  fieldId: z.number(),
  fieldSeqNo: z.number(),
  label: z.string(),
  type: z.string(),
  multiValue: z.boolean(),
  required: z.boolean(),
  setIndex: z.number(),
  value: FieldValueSchema,
  attachments: z.array(FieldAttachmentSchema).optional(),
  validation: FieldValidationSchema,
});

export type FieldValueEntry = z.infer<typeof FieldValueEntrySchema>;

// Upload attachment response
export const UploadAttachmentResponseSchema = z.object({
  attachmentId: z.number(),
  filename: z.string(),
  fileSize: z.number(),
});

export type UploadAttachmentResponse = z.infer<
  typeof UploadAttachmentResponseSchema
>;

// Full step run response shape
export const StepRunSchema = z.object({
  id: z.number(),
  operationRunId: z.number(),
  stepId: z.number(),
  seqNo: z.number(),
  title: z.string(),
  instructions: z.string(),
  multiSet: z.boolean(),
  completed: z.boolean(),
  completionNote: z.string().nullable(),
  fieldValues: z.array(FieldValueEntrySchema),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type StepRun = z.infer<typeof StepRunSchema>;

// Single field value update (setIndex is specified via URL path, not body)
export const UpdateFieldValueSchema = z
  .object({
    value: z.union([z.string().max(2000), z.array(z.string().max(2000))]),
  })
  .strict();

export type UpdateFieldValue = z.infer<typeof UpdateFieldValueSchema>;

// Batch field value update (setIndex is specified via URL path, not body)
export const BatchUpdateFieldValuesSchema = z
  .object({
    fields: z.array(
      z.object({
        fieldSeqNo: z.number().int(),
        value: z.union([z.string().max(2000), z.array(z.string().max(2000))]),
      }),
    ),
  })
  .strict();

export type BatchUpdateFieldValues = z.infer<
  typeof BatchUpdateFieldValuesSchema
>;

// Batch field value response
export const BatchFieldValueResponseSchema = z.object({
  items: z.array(FieldValueEntrySchema),
  total: z.number(),
});

export type BatchFieldValueResponse = z.infer<
  typeof BatchFieldValueResponseSchema
>;

// Response for single field value update — field entry + step-level actions
export const FieldValueUpdateResponseSchema = FieldValueEntrySchema.extend({
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type FieldValueUpdateResponse = z.infer<
  typeof FieldValueUpdateResponseSchema
>;

// Response for batch field value update — field entries + step-level actions
export const BatchFieldValueUpdateResponseSchema =
  BatchFieldValueResponseSchema.extend({
    _actions: z.array(HateoasActionSchema).optional(),
    _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
  });

export type BatchFieldValueUpdateResponse = z.infer<
  typeof BatchFieldValueUpdateResponseSchema
>;

// Response for deleting a field value set
export const DeleteSetResponseSchema = z.object({
  setCount: z.number(),
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type DeleteSetResponse = z.infer<typeof DeleteSetResponseSchema>;

// Input for completing a step run
export const CompleteStepRunSchema = z
  .object({
    completionNote: z.string().max(2000).optional(),
  })
  .strict();

export type CompleteStepRun = z.infer<typeof CompleteStepRunSchema>;

// List response
export const StepRunListResponseSchema = z.object({
  items: z.array(StepRunSchema),
  total: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type StepRunListResponse = z.infer<typeof StepRunListResponseSchema>;

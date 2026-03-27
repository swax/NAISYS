import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasActionTemplateSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
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
  downloadHref: z.string().optional(),
});

export type FieldAttachment = z.infer<typeof FieldAttachmentSchema>;

// Field value: string for scalar fields, string[] for array fields (type ends with "[]")
// Coerce non-strings (e.g. numbers, booleans) to strings so callers don't
// get an opaque "Invalid input" error when they send 2024 instead of "2024".
const coercedString = z.coerce.string();
export const FieldValueSchema = z.union([
  z.array(coercedString),
  coercedString,
]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

/** Human/AI-readable hint for the expected value format per field type. */
export const VALUE_FORMAT_HINTS: Record<string, string> = {
  string: "any text",
  number: 'numeric string, e.g. "42" or "3.14"',
  date: 'YYYY-MM-DD, e.g. "2024-06-15"',
  datetime: 'YYYY-MM-DDTHH:mm, e.g. "2024-06-15T09:30"',
  yesNo: '"Yes" or "No"',
  checkbox: '"checked" or "" (empty string to uncheck)',
  attachment: "managed by file upload endpoints, not set directly",
};

/** Return the API-facing type string, appending "[]" for array fields. */
export function fieldTypeString(type: string, isArray: boolean): string {
  return isArray ? `${type}[]` : type;
}

/** Look up the valueFormat hint for a given field type (handles "[]" suffix). */
export function getValueFormatHint(type: string): string {
  const isArray = type.endsWith("[]");
  const baseType = isArray ? type.slice(0, -2) : type;
  const hint = VALUE_FORMAT_HINTS[baseType] ?? "any text";
  if (isArray) {
    return `value must be a native JSON array (not a string), e.g. ["value1", "value2"]. Each element: ${hint}`;
  }
  return hint;
}

// A single field value entry (API response shape)
export const FieldValueEntrySchema = z.object({
  fieldId: z.number(),
  fieldSeqNo: z.number(),
  label: z.string(),
  type: z.string(),
  valueFormat: z.string(),
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
  note: z.string().nullable(),
  fieldCount: z.number().optional(),
  fieldValues: z.array(FieldValueEntrySchema).optional(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type StepRun = z.infer<typeof StepRunSchema>;

// Single field value update (setIndex is specified via URL path, not body)
const coercedStringMax = z.coerce.string().max(2000);
export const UpdateFieldValueSchema = z
  .object({
    value: z.union([z.array(coercedStringMax), coercedStringMax]),
  })
  .strict();

export type UpdateFieldValue = z.infer<typeof UpdateFieldValueSchema>;

// Batch field value update (setIndex is specified via URL path, not body)
export const BatchUpdateFieldValuesSchema = z
  .object({
    fieldValues: z.array(
      z.object({
        fieldSeqNo: z.number().int(),
        value: z.union([z.array(coercedStringMax), coercedStringMax]),
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

// Slim transition response (complete/reopen)
export const StepRunTransitionSchema = z.object({
  id: z.number(),
  completed: z.boolean(),
  note: z.string().nullable(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type StepRunTransition = z.infer<typeof StepRunTransitionSchema>;

// Query params for listing step runs
export const StepRunListQuerySchema = z.object({
  includeFields: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
});

export type StepRunListQuery = z.infer<typeof StepRunListQuerySchema>;

// List response
export const StepRunListResponseSchema = z.object({
  items: z.array(StepRunSchema),
  total: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type StepRunListResponse = z.infer<typeof StepRunListResponseSchema>;

import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const FieldTypeEnum = z.enum([
  "string",
  "number",
  "date",
  "datetime",
  "yesNo",
  "checkbox",
  "attachment",
]);
export type FieldType = z.infer<typeof FieldTypeEnum>;
export const FieldType = FieldTypeEnum.enum;

// Full field response shape
export const FieldSchema = z.object({
  id: z.number(),
  fieldSetId: z.number(),
  seqNo: z.number(),
  label: z.string(),
  type: FieldTypeEnum,
  multiValue: z.boolean(),
  required: z.boolean(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type Field = z.infer<typeof FieldSchema>;

// Input for creating a field
export const CreateFieldSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    label: z.string().min(1).max(200),
    type: FieldTypeEnum.optional(),
    multiValue: z.boolean().optional(),
    required: z.boolean().optional(),
  })
  .strict();

export type CreateField = z.infer<typeof CreateFieldSchema>;

// Input for batch creating fields
export const BatchCreateFieldSchema = z.object({
  items: z.array(CreateFieldSchema).min(1).max(100),
});

export type BatchCreateField = z.infer<typeof BatchCreateFieldSchema>;

// Input for updating a field
export const UpdateFieldSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    label: z.string().min(1).max(200).optional(),
    type: FieldTypeEnum.optional(),
    multiValue: z.boolean().optional(),
    required: z.boolean().optional(),
  })
  .strict();

export type UpdateField = z.infer<typeof UpdateFieldSchema>;

// List response
export const FieldListResponseSchema = z.object({
  items: z.array(FieldSchema),
  total: z.number(),
  nextSeqNo: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type FieldListResponse = z.infer<typeof FieldListResponseSchema>;

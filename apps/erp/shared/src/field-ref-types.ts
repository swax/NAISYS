import { z } from "zod/v4";

import { FieldTypeEnum } from "./field-types.js";
import {
  HateoasActionSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "./hateoas-types.js";

// Field definition summary within a field ref
export const FieldRefFieldSchema = z.object({
  seqNo: z.number(),
  label: z.string(),
  type: FieldTypeEnum,
});

export type FieldRefField = z.infer<typeof FieldRefFieldSchema>;

// Full field ref response shape (plan level)
export const FieldRefSchema = z.object({
  id: z.number(),
  seqNo: z.number(),
  title: z.string(),
  sourceOpSeqNo: z.number(),
  sourceOpTitle: z.string(),
  sourceStepSeqNo: z.number(),
  sourceStepTitle: z.string(),
  fields: z.array(FieldRefFieldSchema),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type FieldRef = z.infer<typeof FieldRefSchema>;

// Input for creating a field ref
export const CreateFieldRefSchema = z
  .object({
    seqNo: z.number().int().min(1).optional(),
    title: z.string().min(1).max(200),
    sourceOpSeqNo: z.number().int().min(1),
    sourceStepSeqNo: z.number().int().min(1),
  })
  .strict();

export type CreateFieldRef = z.infer<typeof CreateFieldRefSchema>;

// List response
export const FieldRefListResponseSchema = z.object({
  items: z.array(FieldRefSchema),
  total: z.number(),
  nextSeqNo: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type FieldRefListResponse = z.infer<typeof FieldRefListResponseSchema>;

// Field ref value summary embedded in OperationRun GET response
// Uses FieldValueEntry from step-run-types for compatibility with FieldValueRunList
import { FieldValueEntrySchema } from "./step-run-types.js";

export const FieldRefValueSummarySchema = z.object({
  seqNo: z.number(),
  title: z.string(),
  sourceOpSeqNo: z.number(),
  sourceOpTitle: z.string(),
  sourceStepSeqNo: z.number(),
  sourceStepTitle: z.string(),
  multiSet: z.boolean(),
  fieldValues: z.array(FieldValueEntrySchema),
});

export type FieldRefValueSummary = z.infer<typeof FieldRefValueSummarySchema>;

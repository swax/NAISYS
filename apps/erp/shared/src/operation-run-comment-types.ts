import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const OperationRunCommentTypeEnum = z.enum([
  "note",
  "issue",
  "feedback",
]);
export type OperationRunCommentType = z.infer<
  typeof OperationRunCommentTypeEnum
>;
export const OperationRunCommentType = OperationRunCommentTypeEnum.enum;

export const OperationRunCommentSchema = z.object({
  id: z.number(),
  operationRunId: z.number(),
  type: OperationRunCommentTypeEnum,
  body: z.string(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  _links: z.array(HateoasLinkSchema),
});

export type OperationRunComment = z.infer<typeof OperationRunCommentSchema>;

export const CreateOperationRunCommentSchema = z
  .object({
    type: OperationRunCommentTypeEnum.optional(),
    body: z.string().min(1).max(5000),
  })
  .strict();

export type CreateOperationRunComment = z.infer<
  typeof CreateOperationRunCommentSchema
>;

export const OperationRunCommentListResponseSchema = z.object({
  items: z.array(OperationRunCommentSchema),
  total: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationRunCommentListResponse = z.infer<
  typeof OperationRunCommentListResponseSchema
>;

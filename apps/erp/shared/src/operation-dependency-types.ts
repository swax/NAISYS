import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// Full dependency response shape
export const OperationDependencySchema = z.object({
  id: z.number(),
  predecessorSeqNo: z.number(),
  predecessorTitle: z.string(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationDependency = z.infer<typeof OperationDependencySchema>;

// Input for creating a dependency
export const CreateOperationDependencySchema = z
  .object({
    predecessorSeqNo: z.number().int().min(1),
  })
  .strict();

export type CreateOperationDependency = z.infer<
  typeof CreateOperationDependencySchema
>;

// List response
export const OperationDependencyListResponseSchema = z.object({
  items: z.array(OperationDependencySchema),
  total: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type OperationDependencyListResponse = z.infer<
  typeof OperationDependencyListResponseSchema
>;

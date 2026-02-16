import { z } from "zod/v4";
import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

export const RevisionStatusEnum = z.enum(["draft", "approved", "obsolete"]);
export type RevisionStatus = z.infer<typeof RevisionStatusEnum>;

// Full revision response shape
export const PlanningOrderRevisionSchema = z.object({
  id: z.number(),
  planOrderId: z.number(),
  revNo: z.number(),
  status: RevisionStatusEnum,
  notes: z.string().nullable(),
  changeSummary: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.number(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type PlanningOrderRevision = z.infer<typeof PlanningOrderRevisionSchema>;

// Input for creating a revision
export const CreatePlanningOrderRevisionSchema = z
  .object({
    notes: z.string().max(2000).optional(),
    changeSummary: z.string().max(2000).optional(),
  })
  .strict();

export type CreatePlanningOrderRevision = z.infer<
  typeof CreatePlanningOrderRevisionSchema
>;

// Input for updating a revision
export const UpdatePlanningOrderRevisionSchema = z
  .object({
    notes: z.string().max(2000).optional(),
    changeSummary: z.string().max(2000).optional(),
  })
  .strict();

export type UpdatePlanningOrderRevision = z.infer<
  typeof UpdatePlanningOrderRevisionSchema
>;

// Query params for listing revisions
export const PlanningOrderRevisionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: RevisionStatusEnum.optional(),
});

export type PlanningOrderRevisionListQuery = z.infer<
  typeof PlanningOrderRevisionListQuerySchema
>;

// List response
export const PlanningOrderRevisionListResponseSchema = z.object({
  items: z.array(PlanningOrderRevisionSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type PlanningOrderRevisionListResponse = z.infer<
  typeof PlanningOrderRevisionListResponseSchema
>;

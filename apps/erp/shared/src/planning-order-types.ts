import { z } from "zod/v4";
import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";

// Full planning order response shape
export const PlanningOrderSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedBy: z.string(),
  updatedAt: z.iso.datetime(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type PlanningOrder = z.infer<typeof PlanningOrderSchema>;

// Input for creating a planning order
export const CreatePlanningOrderSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Key must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  createdBy: z.string().min(1),
});

export type CreatePlanningOrder = z.infer<typeof CreatePlanningOrderSchema>;

// Input for updating a planning order
export const UpdatePlanningOrderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "archived"]).optional(),
  updatedBy: z.string().min(1),
});

export type UpdatePlanningOrder = z.infer<typeof UpdatePlanningOrderSchema>;

// Query params for listing planning orders
export const PlanningOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(["active", "archived"]).optional(),
  search: z.string().optional(),
});

export type PlanningOrderListQuery = z.infer<
  typeof PlanningOrderListQuerySchema
>;

// List response
export const PlanningOrderListResponseSchema = z.object({
  items: z.array(PlanningOrderSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type PlanningOrderListResponse = z.infer<
  typeof PlanningOrderListResponseSchema
>;

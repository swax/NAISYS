import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "./hateoas-types.js";
import { paginationQuery } from "./pagination-types.js";

// Work center user assignment (embedded in detail response)
export const WorkCenterUserSchema = z.object({
  userId: z.number(),
  username: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type WorkCenterUserItem = z.infer<typeof WorkCenterUserSchema>;

// Full work center response
export const WorkCenterSchema = z.object({
  id: z.number(),
  key: z.string(),
  description: z.string(),
  userAssignments: z.array(WorkCenterUserSchema),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type WorkCenter = z.infer<typeof WorkCenterSchema>;

// Input for creating a work center
export const CreateWorkCenterSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/,
        "Key must be alphanumeric with hyphens",
      ),
    description: z.string().max(2000).optional().default(""),
  })
  .strict();

export type CreateWorkCenter = z.infer<typeof CreateWorkCenterSchema>;

// Input for updating a work center
export const UpdateWorkCenterSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/,
        "Key must be alphanumeric with hyphens",
      )
      .optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

export type UpdateWorkCenter = z.infer<typeof UpdateWorkCenterSchema>;

// Input for assigning a user to a work center
export const AssignWorkCenterUserSchema = z
  .object({
    username: z.string().min(1),
  })
  .strict();

export type AssignWorkCenterUser = z.infer<typeof AssignWorkCenterUserSchema>;

// Query params for listing work centers
export const WorkCenterListQuerySchema = z.object({
  ...paginationQuery(),
  search: z.string().optional(),
});

export type WorkCenterListQuery = z.infer<typeof WorkCenterListQuerySchema>;

// Work center list item (lighter response)
export const WorkCenterListItemSchema = z.object({
  id: z.number(),
  key: z.string(),
  description: z.string(),
  userCount: z.number(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
});

export type WorkCenterListItem = z.infer<typeof WorkCenterListItemSchema>;

// List response
export const WorkCenterListResponseSchema = z.object({
  items: z.array(WorkCenterListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type WorkCenterListResponse = z.infer<
  typeof WorkCenterListResponseSchema
>;

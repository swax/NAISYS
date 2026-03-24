import { z } from "zod/v4";

import {
  HateoasActionSchema,
  HateoasActionTemplateSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "./hateoas-types.js";

export const LaborTicketSchema = z.object({
  id: z.number(),
  operationRunId: z.number(),
  userId: z.number(),
  username: z.string(),
  runId: z.number().nullable(),
  clockIn: z.iso.datetime(),
  clockOut: z.iso.datetime().nullable(),
  cost: z.number().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
  _links: z.array(HateoasLinkSchema).optional(),
});

export type LaborTicket = z.infer<typeof LaborTicketSchema>;

export const ClockOutLaborTicketSchema = z
  .object({
    userId: z.number().int().optional(),
    ticketId: z.number().int().optional(),
  })
  .strict();

export type ClockOutLaborTicket = z.infer<typeof ClockOutLaborTicketSchema>;

export const LaborTicketListResponseSchema = z.object({
  items: z.array(LaborTicketSchema),
  total: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export type LaborTicketListResponse = z.infer<
  typeof LaborTicketListResponseSchema
>;

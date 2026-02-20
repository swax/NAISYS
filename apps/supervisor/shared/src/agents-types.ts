import { HateoasActionSchema } from "@naisys/common";
import { z } from "zod";

const LinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
  title: z.string().optional(),
});

// Zod schemas
export const AgentSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  name: z.string(),
  title: z.string(),
  host: z.string(),
  lastActive: z.string().optional(),
  leadUsername: z.string().optional(),
  latestLogId: z.number(),
  latestMailId: z.number(),
  archived: z.boolean().optional(),
  online: z.boolean().optional(),
  _links: z.array(LinkSchema).optional(),
});

export const HostSchema = z.object({
  id: z.number(),
  name: z.string(),
  lastActive: z.string().nullable(),
  agentCount: z.number(),
  online: z.boolean().optional(),
  _links: z.array(LinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const HostIdParamsSchema = z.object({
  id: z.coerce.number(),
});

export const AgentListRequestSchema = z.object({
  updatedSince: z.string().optional(),
});

export const AgentListResponseSchema = z.object({
  items: z.array(AgentSchema),
  timestamp: z.string(),
  _links: z.array(LinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const AgentIdParamsSchema = z.object({
  id: z.coerce.number(),
});

export const AgentDetailResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  title: z.string(),
  host: z.string(),
  lastActive: z.string().optional(),
  leadUsername: z.string().optional(),
  latestLogId: z.number(),
  latestMailId: z.number(),
  archived: z.boolean().optional(),
  online: z.boolean().optional(),
  config: z.string(),
  _links: z.array(LinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const HostListResponseSchema = z.object({
  items: z.array(HostSchema),
  _links: z.array(LinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

// Inferred types
export type Agent = z.infer<typeof AgentSchema>;
export type Host = z.infer<typeof HostSchema>;
export type AgentListRequest = z.infer<typeof AgentListRequestSchema>;
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;
export type AgentIdParams = z.infer<typeof AgentIdParamsSchema>;
export type AgentDetailResponse = z.infer<typeof AgentDetailResponseSchema>;
export type HostIdParams = z.infer<typeof HostIdParamsSchema>;
export type HostListResponse = z.infer<typeof HostListResponseSchema>;

export const SetLeadAgentRequestSchema = z
  .object({
    leadAgentId: z.number().nullable(),
  })
  .strict();
export type SetLeadAgentRequest = z.infer<typeof SetLeadAgentRequestSchema>;

export const AgentActionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type AgentActionResult = z.infer<typeof AgentActionResultSchema>;

export const AgentStartRequestSchema = z
  .object({
    task: z.string().optional(),
  })
  .strict();
export type AgentStartRequest = z.infer<typeof AgentStartRequestSchema>;

export const AgentStartResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  hostname: z.string().optional(),
});
export type AgentStartResult = z.infer<typeof AgentStartResultSchema>;

export const AgentStopResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type AgentStopResult = z.infer<typeof AgentStopResultSchema>;

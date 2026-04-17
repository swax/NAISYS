import {
  AgentConfigFileSchema,
  HateoasActionSchema,
  HateoasActionTemplateSchema,
  HateoasLinkTemplateSchema,
  URL_SAFE_KEY_MESSAGE,
  URL_SAFE_KEY_REGEX,
} from "@naisys/common";
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
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  budgetLeft: z.number().nullable().optional(),
  status: z
    .enum(["active", "available", "disabled", "offline", "suspended"])
    .optional(),
});

export const HostSchema = z.object({
  id: z.number(),
  name: z.string(),
  lastActive: z.string().nullable(),
  agentCount: z.number(),
  restricted: z.boolean().optional(),
  hostType: z.string().optional(),
  online: z.boolean().optional(),
  version: z.string().optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const HostNameParamsSchema = z.object({
  hostname: z.string(),
});

export const AgentListRequestSchema = z.object({
  updatedSince: z.string().optional(),
});

export const AgentListResponseSchema = z.object({
  items: z.array(AgentSchema),
  timestamp: z.string(),
  _links: z.array(LinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const AgentUsernameParamsSchema = z.object({
  username: z.string(),
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
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  status: z
    .enum(["active", "available", "disabled", "offline", "suspended"])
    .optional(),
  costSuspendedReason: z.string().optional(),
  currentSpend: z.number().optional(),
  spendLimitResetAt: z.string().optional(),
  config: AgentConfigFileSchema,
  resolvedEnvVars: z.record(z.string(), z.string()).optional(),
  assignedHosts: z
    .array(z.object({ id: z.number(), name: z.string() }))
    .optional(),
  _links: z.array(LinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const HostListResponseSchema = z.object({
  items: z.array(HostSchema),
  targetVersion: z.string().optional(),
  _links: z.array(LinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

// Inferred types
export type Agent = z.infer<typeof AgentSchema>;
export type Host = z.infer<typeof HostSchema>;
export type AgentListRequest = z.infer<typeof AgentListRequestSchema>;
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;
export type AgentUsernameParams = z.infer<typeof AgentUsernameParamsSchema>;
export type AgentDetailResponse = z.infer<typeof AgentDetailResponseSchema>;
export type HostNameParams = z.infer<typeof HostNameParamsSchema>;
export type HostListResponse = z.infer<typeof HostListResponseSchema>;

export const SetLeadAgentRequestSchema = z
  .object({
    leadAgentUsername: z.string().nullable(),
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

export const AgentToggleRequestSchema = z
  .object({
    recursive: z.boolean().optional(),
  })
  .strict();
export type AgentToggleRequest = z.infer<typeof AgentToggleRequestSchema>;

export const AgentStopRequestSchema = z
  .object({
    recursive: z.boolean().optional(),
  })
  .strict();
export type AgentStopRequest = z.infer<typeof AgentStopRequestSchema>;

export const AgentStopResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type AgentStopResult = z.infer<typeof AgentStopResultSchema>;

// --- Host CRUD schemas ---

const AssignedAgentSchema = z.object({
  id: z.number(),
  name: z.string(),
  title: z.string(),
});

export const HostEnvironmentSchema = z.object({
  platform: z.string(),
  osVersion: z.string(),
  shell: z.string(),
  arch: z.string().optional(),
  nodeVersion: z.string().optional(),
});
export type HostEnvironment = z.infer<typeof HostEnvironmentSchema>;

export const HostDetailResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  machineId: z.string().nullable(),
  lastActive: z.string().nullable(),
  lastIp: z.string().nullable(),
  restricted: z.boolean(),
  hostType: z.string(),
  online: z.boolean(),
  version: z.string(),
  environment: HostEnvironmentSchema.nullable(),
  assignedAgents: z.array(AssignedAgentSchema),
  _links: z.array(LinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});
export type HostDetailResponse = z.infer<typeof HostDetailResponseSchema>;

export const UpdateHostRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(URL_SAFE_KEY_REGEX, URL_SAFE_KEY_MESSAGE)
      .optional(),
    restricted: z.boolean().optional(),
  })
  .strict();
export type UpdateHostRequest = z.infer<typeof UpdateHostRequestSchema>;

export const CreateHostRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(URL_SAFE_KEY_REGEX, URL_SAFE_KEY_MESSAGE),
  })
  .strict();
export type CreateHostRequest = z.infer<typeof CreateHostRequestSchema>;

export const AssignAgentToHostRequestSchema = z
  .object({
    agentId: z.number().int(),
  })
  .strict();
export type AssignAgentToHostRequest = z.infer<
  typeof AssignAgentToHostRequestSchema
>;

export const AgentNameParamSchema = z.object({
  agentName: z.string(),
});

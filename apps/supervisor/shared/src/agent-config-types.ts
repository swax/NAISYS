import {
  AgentConfigFileSchema,
  HateoasActionSchema,
  HateoasLinkSchema,
  URL_SAFE_KEY_MESSAGE,
  URL_SAFE_KEY_REGEX,
} from "@naisys/common";
import { z } from "zod";

// Zod schemas for agent config operations

export const CreateAgentConfigRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(URL_SAFE_KEY_REGEX, URL_SAFE_KEY_MESSAGE),
    title: z.string().max(200).optional(),
  })
  .strict();

export const CreateAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  name: z.string().optional(),
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const UpdateAgentConfigRequestSchema = z
  .object({
    config: AgentConfigFileSchema,
  })
  .strict();

export const UpdateAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const ImportAgentConfigRequestSchema = z
  .object({
    yaml: z.string().min(1),
  })
  .strict();

export const ImportAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const GetAgentConfigResponseSchema = z.object({
  config: AgentConfigFileSchema,
  _actions: z.array(HateoasActionSchema).optional(),
});

export const ExportAgentConfigResponseSchema = z.object({
  yaml: z.string(),
});

// Inferred types
export type CreateAgentConfigRequest = z.infer<
  typeof CreateAgentConfigRequestSchema
>;
export type CreateAgentConfigResponse = z.infer<
  typeof CreateAgentConfigResponseSchema
>;
export type UpdateAgentConfigRequest = z.infer<
  typeof UpdateAgentConfigRequestSchema
>;
export type UpdateAgentConfigResponse = z.infer<
  typeof UpdateAgentConfigResponseSchema
>;
export type ImportAgentConfigRequest = z.infer<
  typeof ImportAgentConfigRequestSchema
>;
export type ImportAgentConfigResponse = z.infer<
  typeof ImportAgentConfigResponseSchema
>;
export type GetAgentConfigResponse = z.infer<
  typeof GetAgentConfigResponseSchema
>;
export type ExportAgentConfigResponse = z.infer<
  typeof ExportAgentConfigResponseSchema
>;

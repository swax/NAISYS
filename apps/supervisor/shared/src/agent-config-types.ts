import { z } from "zod";

// Zod schemas for agent config operations
export const GetAgentConfigRequestSchema = z.object({
  username: z.string(),
});

export const GetAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  config: z.string().optional(),
  path: z.string().optional(),
});

export const CreateAgentConfigRequestSchema = z.object({
  name: z.string().min(1).max(100),
});

export const CreateAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const UpdateAgentConfigRequestSchema = z.object({
  username: z.string(),
  config: z.string(),
});

export const UpdateAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Inferred types
export type GetAgentConfigRequest = z.infer<typeof GetAgentConfigRequestSchema>;
export type GetAgentConfigResponse = z.infer<
  typeof GetAgentConfigResponseSchema
>;
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

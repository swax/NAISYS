import { z } from "zod";

// Zod schemas for agent config operations

export const CreateAgentConfigRequestSchema = z.object({
  name: z.string().min(1).max(100),
});

export const CreateAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const UpdateAgentConfigRequestSchema = z.object({
  config: z.string(),
});

export const UpdateAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
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

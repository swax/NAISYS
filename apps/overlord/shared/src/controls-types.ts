import { z } from "zod";

// Zod schemas
export const GetAgentConfigRequestSchema = z.object({
  username: z.string(),
});

export const GetAgentConfigResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  config: z.string().optional(),
});

// Inferred types
export type GetAgentConfigRequest = z.infer<typeof GetAgentConfigRequestSchema>;
export type GetAgentConfigResponse = z.infer<
  typeof GetAgentConfigResponseSchema
>;

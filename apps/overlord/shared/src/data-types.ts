import { z } from "zod";
import { AgentSchema } from "./agents-types.js";

// Zod schemas
export const NaisysDataRequestSchema = z.object({});

export const NaisysDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      agents: z.array(AgentSchema),
      timestamp: z.string(),
    })
    .optional(),
});

// Inferred types
export type NaisysDataRequest = z.infer<typeof NaisysDataRequestSchema>;
export type NaisysDataResponse = z.infer<typeof NaisysDataResponseSchema>;

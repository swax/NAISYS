import { z } from "zod";
import { AgentSchema, HostSchema } from "./agents-types.js";

// Zod schemas
export const NaisysDataRequestSchema = z.object({
  updatedSince: z.string().optional(),
});

export const NaisysDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      agents: z.array(AgentSchema),
      hosts: z.array(HostSchema),
      timestamp: z.string(),
    })
    .optional(),
});

// Inferred types
export type NaisysDataRequest = z.infer<typeof NaisysDataRequestSchema>;
export type NaisysDataResponse = z.infer<typeof NaisysDataResponseSchema>;

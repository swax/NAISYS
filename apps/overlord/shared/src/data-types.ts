import { z } from "zod";
import { AgentSchema } from "./agents-types.js";

// Zod schemas
export const ReadStatusSchema = z.object({
  lastReadLogId: z.number().optional(), // Client-side only
  latestLogId: z.number(),
  lastReadMailId: z.number().optional(), // Client-side only
  latestMailId: z.number(),
});

export const NaisysDataRequestSchema = z.object({});

export const NaisysDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      agents: z.array(AgentSchema),
      timestamp: z.string(),
      readStatus: z.record(z.string(), ReadStatusSchema),
    })
    .optional(),
});

// Inferred types
export type ReadStatus = z.infer<typeof ReadStatusSchema>;
export type NaisysDataRequest = z.infer<typeof NaisysDataRequestSchema>;
export type NaisysDataResponse = z.infer<typeof NaisysDataResponseSchema>;

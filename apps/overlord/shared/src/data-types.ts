import { z } from "zod";
import { AgentSchema } from "./agents-types.js";
import { LogEntrySchema } from "./log-types.js";
import { ThreadMessageSchema } from "./mail-types.js";

// Zod schemas
export const ReadStatusSchema = z.object({
  lastReadLogId: z.number().optional(), // Client-side only
  latestLogId: z.number(),
  lastReadMailId: z.number().optional(), // Client-side only
  latestMailId: z.number(),
});

export const NaisysDataRequestSchema = z.object({
  logsAfter: z.string().optional(),
  logsLimit: z.string().optional(),
  mailAfter: z.string().optional(),
  mailLimit: z.string().optional(),
});

export const NaisysDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      agents: z.array(AgentSchema),
      logs: z.array(LogEntrySchema),
      mail: z.array(ThreadMessageSchema),
      timestamp: z.string(),
      readStatus: z.record(z.string(), ReadStatusSchema),
    })
    .optional(),
});

// Inferred types
export type ReadStatus = z.infer<typeof ReadStatusSchema>;
export type NaisysDataRequest = z.infer<typeof NaisysDataRequestSchema>;
export type NaisysDataResponse = z.infer<typeof NaisysDataResponseSchema>;

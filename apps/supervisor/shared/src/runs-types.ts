import { z } from "zod";
import { LogEntrySchema } from "./log-types.js";

// Zod schemas
export const RunSessionSchema = z.object({
  userId: z.string(),
  runId: z.number(),
  sessionId: z.number(),
  createdAt: z.string(),
  lastActive: z.string(),
  modelName: z.string(),
  latestLogId: z.string(),
  totalLines: z.number(),
  totalCost: z.number(),
});

export const RunsDataRequestSchema = z.object({
  userId: z.string(),
  updatedSince: z.string().optional(),
  page: z.coerce.number().optional().default(1),
  count: z.coerce.number().optional().default(50),
});

export const RunsDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      runs: z.array(RunSessionSchema),
      timestamp: z.string(),
      total: z.number().optional(),
    })
    .optional(),
});

export const ContextLogRequestSchema = z.object({
  userId: z.string(),
  runId: z.coerce.number(),
  sessionId: z.coerce.number(),
  logsAfter: z.string().optional(),
});

export const ContextLogResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      logs: z.array(LogEntrySchema),
      timestamp: z.string(),
    })
    .optional(),
});

// Inferred types
export type RunSession = z.infer<typeof RunSessionSchema>;
export type RunsDataRequest = z.infer<typeof RunsDataRequestSchema>;
export type RunsDataResponse = z.infer<typeof RunsDataResponseSchema>;
export type ContextLogRequest = z.infer<typeof ContextLogRequestSchema>;
export type ContextLogResponse = z.infer<typeof ContextLogResponseSchema>;

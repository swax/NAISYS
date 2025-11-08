import { z } from "zod";
import { LogEntrySchema } from "./log-types.js";

// Zod schemas
export const RunSessionSchema = z.object({
  userId: z.number(),
  runId: z.number(),
  sessionId: z.number(),
  startDate: z.string(),
  lastActive: z.string(),
  modelName: z.string(),
  totalLines: z.number(),
  totalCost: z.number(),
  isOnline: z.boolean(),
});

export const RunsDataRequestSchema = z.object({
  userId: z.string(),
  updatedSince: z.string().optional(),
});

export const RunsDataResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      runs: z.array(RunSessionSchema),
      timestamp: z.string(),
    })
    .optional(),
});

export const ContextLogRequestSchema = z.object({
  userId: z.string(),
  runId: z.string(),
  sessionId: z.string(),
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

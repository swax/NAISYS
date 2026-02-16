import { HateoasLinkSchema } from "@naisys/common";
import { z } from "zod";
import { LogEntrySchema } from "./log-types.js";

// Zod schemas
export const RunSessionSchema = z.object({
  userId: z.number(),
  runId: z.number(),
  sessionId: z.number(),
  createdAt: z.string(),
  lastActive: z.string(),
  modelName: z.string(),
  latestLogId: z.number(),
  totalLines: z.number(),
  totalCost: z.number(),
  _links: z.array(HateoasLinkSchema).optional(),
});

export const RunsDataRequestSchema = z.object({
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
  _links: z.array(HateoasLinkSchema).optional(),
});

export const ContextLogParamsSchema = z.object({
  id: z.coerce.number(),
  runId: z.coerce.number(),
  sessionId: z.coerce.number(),
});

export const ContextLogRequestSchema = z.object({
  logsAfter: z.coerce.number().optional(),
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
  _links: z.array(HateoasLinkSchema).optional(),
});

// Inferred types
export type RunSession = z.infer<typeof RunSessionSchema>;
export type RunsDataRequest = z.infer<typeof RunsDataRequestSchema>;
export type RunsDataResponse = z.infer<typeof RunsDataResponseSchema>;
export type ContextLogParams = z.infer<typeof ContextLogParamsSchema>;
export type ContextLogRequest = z.infer<typeof ContextLogRequestSchema>;
export type ContextLogResponse = z.infer<typeof ContextLogResponseSchema>;

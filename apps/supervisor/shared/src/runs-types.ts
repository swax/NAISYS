import { HateoasLinkSchema, HateoasLinkTemplateSchema } from "@naisys/common";
import { z } from "zod";

import { HostEnvironmentSchema } from "./agents-types.js";
import { LogEntrySchema, LogSourceSchema } from "./log-types.js";
import { timestampPagingQuery } from "./pagination-types.js";

// Zod schemas
export const RunSessionSchema = z.object({
  userId: z.number(),
  username: z.string().optional(),
  runId: z.number(),
  subagentId: z.number().nullable().optional(),
  sessionId: z.number(),
  createdAt: z.string(),
  lastActive: z.string(),
  modelName: z.string(),
  latestLogId: z.number(),
  totalLines: z.number(),
  totalCost: z.number(),
  hostName: z.string().nullable().optional(),
  hostEnvironment: HostEnvironmentSchema.nullable().optional(),
});

export const RunsDataRequestSchema = z.object({
  ...timestampPagingQuery(),
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
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
});

export const ContextLogParamsSchema = z.object({
  username: z.string(),
  runId: z.coerce.number(),
  sessionId: z.coerce.number(),
});

export const SubagentSessionParamsSchema = z.object({
  username: z.string(),
  runId: z.coerce.number(),
  // Synthetic subagent ids are always negative on the host side.
  subagentId: z.coerce.number().negative(),
  sessionId: z.coerce.number(),
});

export const CONTEXT_LOG_MAX_LIMIT = 1000;

export const ContextLogRequestSchema = z.object({
  logsAfter: z.coerce.number().optional(),
  logsBefore: z.coerce.number().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .transform((n) => Math.min(n, CONTEXT_LOG_MAX_LIMIT))
    .optional(),
  // Comma-separated list, e.g. "endPrompt" or "endPrompt,llm"
  sources: z
    .preprocess(
      (val) =>
        typeof val === "string"
          ? val
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : val,
      z.array(LogSourceSchema),
    )
    .optional(),
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

export const AGENT_RUN_LOG_ENTRIES_DEFAULT_LIMIT = 5000;
export const AGENT_RUN_LOG_ENTRIES_MAX_LIMIT = 10000;

export const AgentRunLogEntrySchema = z.object({
  logId: z.number(),
  runId: z.number(),
  sessionId: z.number(),
  subagentId: z.number().nullable().optional(),
  source: LogSourceSchema,
  message: z.string(),
  createdAt: z.string(),
});

const csvNumberArray = z.preprocess(
  (val) =>
    typeof val === "string"
      ? val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => Number(s))
      : val,
  z.array(z.number().int()).min(1),
);

const csvSourceArray = z.preprocess(
  (val) =>
    typeof val === "string"
      ? val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : val,
  z.array(LogSourceSchema).min(1),
);

export const AgentRunLogEntriesRequestSchema = z.object({
  runIds: csvNumberArray,
  sources: csvSourceArray,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .transform((n) => Math.min(n, AGENT_RUN_LOG_ENTRIES_MAX_LIMIT))
    .optional(),
});

export const AgentRunLogEntriesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      entries: z.array(AgentRunLogEntrySchema),
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
export type SubagentSessionParams = z.infer<typeof SubagentSessionParamsSchema>;
export type ContextLogRequest = z.infer<typeof ContextLogRequestSchema>;
export type ContextLogResponse = z.infer<typeof ContextLogResponseSchema>;
export type AgentRunLogEntry = z.infer<typeof AgentRunLogEntrySchema>;
export type AgentRunLogEntriesRequest = z.infer<
  typeof AgentRunLogEntriesRequestSchema
>;
export type AgentRunLogEntriesResponse = z.infer<
  typeof AgentRunLogEntriesResponseSchema
>;

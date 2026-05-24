import { HateoasLinkSchema } from "@naisys/common";
import { z } from "zod";

import { CostBucketSchema, CostByAgentSchema } from "./cost-types.js";

// At-a-glance counters for the dashboard stat strip.
export const DashboardStatsSchema = z.object({
  agentsActive: z.number(),
  agentsTotal: z.number(),
  runsLast24h: z.number(),
  spendLast24h: z.number(),
  tokensLast24h: z.number(),
  spendLimitDollars: z.number().nullable(),
  spendLimitHours: z.number().nullable(),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

// An agent stopped by its spend limit, with the hub's reason text.
export const DashboardSuspendedAgentSchema = z.object({
  username: z.string(),
  title: z.string(),
  reason: z.string(),
});
export type DashboardSuspendedAgent = z.infer<
  typeof DashboardSuspendedAgentSchema
>;

// A recent agent run session (parent runs only — subagents are excluded).
export const DashboardRunSchema = z.object({
  username: z.string(),
  title: z.string(),
  runId: z.number(),
  sessionId: z.number(),
  createdAt: z.string(),
  lastActive: z.string(),
  isOnline: z.boolean(),
  modelName: z.string(),
  totalTokens: z.number(),
  totalCost: z.number(),
  /** "manual" | "wake-on-message" | "schedule:<name>"; null on legacy rows. */
  triggeredBy: z.string().nullable(),
  hostName: z.string().nullable(),
});
export type DashboardRun = z.infer<typeof DashboardRunSchema>;

// A recent inter-agent message (mail or chat), with a body preview.
export const DashboardMessageSchema = z.object({
  id: z.number(),
  kind: z.enum(["mail", "chat"]),
  fromUsername: z.string(),
  fromTitle: z.string(),
  subject: z.string(),
  snippet: z.string(),
  createdAt: z.string(),
});
export type DashboardMessage = z.infer<typeof DashboardMessageSchema>;

// Recent errors collapsed to one entry per run; click through for the text.
export const DashboardErrorRunSchema = z.object({
  username: z.string(),
  title: z.string(),
  runId: z.number(),
  sessionId: z.number(),
  errorCount: z.number(),
  lastErrorAt: z.string(),
});
export type DashboardErrorRun = z.infer<typeof DashboardErrorRunSchema>;

// An agent with a pending scheduled run.
export const DashboardScheduleSchema = z.object({
  username: z.string(),
  title: z.string(),
  nextRunAt: z.string(),
});
export type DashboardSchedule = z.infer<typeof DashboardScheduleSchema>;

// Host health summary row.
export const DashboardHostSchema = z.object({
  name: z.string(),
  hostType: z.string(),
  online: z.boolean(),
  agentCount: z.number(),
  platform: z.string().nullable(),
});
export type DashboardHost = z.infer<typeof DashboardHostSchema>;

// Cost/usage over the trailing 24 hours — reuses the /costs histogram types.
export const DashboardCostSummarySchema = z.object({
  buckets: z.array(CostBucketSchema),
  byAgent: z.array(CostByAgentSchema),
});
export type DashboardCostSummary = z.infer<typeof DashboardCostSummarySchema>;

export const DashboardDataSchema = z.object({
  generatedAt: z.string(),
  stats: DashboardStatsSchema,
  suspendedAgents: z.array(DashboardSuspendedAgentSchema),
  recentRuns: z.array(DashboardRunSchema),
  recentMessages: z.array(DashboardMessageSchema),
  upcomingSchedules: z.array(DashboardScheduleSchema),
  hosts: z.array(DashboardHostSchema),
  costSummary: DashboardCostSummarySchema,
  errorRuns: z.array(DashboardErrorRunSchema),
});
export type DashboardData = z.infer<typeof DashboardDataSchema>;

export const DashboardResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: DashboardDataSchema.optional(),
  _links: z.array(HateoasLinkSchema).optional(),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

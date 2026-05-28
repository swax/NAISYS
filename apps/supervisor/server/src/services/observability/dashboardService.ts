import type {
  DashboardData,
  DashboardErrorRun,
  DashboardMessage,
  DashboardRun,
} from "@naisys/supervisor-shared";

import { hubDb } from "../../database/hubDb.js";
import {
  isAgentActive,
  isHostConnected,
  isRunOnline,
} from "../agents/agentHostStatusService.js";
import { getHosts } from "../hostService.js";
import {
  getCostHistogram,
  getCostsByAgent,
  getSpendLimitSettings,
} from "./costsService.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of each recent-activity list to surface on the dashboard. */
const RECENT_RUNS_LIMIT = 8;
const RECENT_MESSAGES_LIMIT = 8;
const UPCOMING_SCHEDULES_LIMIT = 6;
const ERROR_RUNS_LIMIT = 5;
const TOP_AGENTS_LIMIT = 5;

/** Runs by these users are operational noise on a recent-activity view. */
const EXCLUDED_RUN_USERNAMES = ["admin"];

/** Newest error context_log rows to inspect when grouping by run. */
const ERROR_SCAN_LIMIT = 50;
/**
 * Errors are scanned only within the most recent slice of context_log (by id)
 * so this polled endpoint never degrades into a full-table scan as the log
 * grows — context_log has no index on `type`.
 */
const ERROR_SCAN_WINDOW = 20_000;

function makeSnippet(body: string, max = 140): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/**
 * Aggregate a recent-activity snapshot of the whole system for the supervisor
 * home dashboard: agent runs, inter-agent messages, spend, schedules, host
 * health, spend-limit suspensions and recent errors, in a single response.
 */
export async function getDashboard(): Promise<DashboardData> {
  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS);

  // Bound the error scan to the newest slice of context_log (see ERROR_SCAN_WINDOW).
  const maxLog = await hubDb.context_log.aggregate({ _max: { id: true } });
  const errorFloorId = Math.max(0, (maxLog._max.id ?? 0) - ERROR_SCAN_WINDOW);

  const [
    agentRows,
    runsLast24h,
    spend24h,
    recentRunRows,
    recentMessageRows,
    errorLogRows,
    suspendedRows,
    scheduleRows,
    hostRows,
    spendLimits,
    buckets,
    byAgent,
  ] = await Promise.all([
    hubDb.users.findMany({
      where: { archived: false },
      select: { id: true },
    }),
    hubDb.run_session.count({
      where: { subagent_id: 0, created_at: { gte: since24h } },
    }),
    hubDb.costs.aggregate({
      where: { created_at: { gte: since24h } },
      _sum: { cost: true, input_tokens: true, output_tokens: true },
    }),
    hubDb.run_session.findMany({
      where: {
        subagent_id: 0,
        users: { username: { notIn: EXCLUDED_RUN_USERNAMES } },
      },
      orderBy: { last_active: "desc" },
      take: RECENT_RUNS_LIMIT,
      select: {
        user_id: true,
        run_id: true,
        session_id: true,
        created_at: true,
        last_active: true,
        model_name: true,
        total_tokens: true,
        total_cost: true,
        triggered_by: true,
        users: { select: { username: true, title: true } },
        host: { select: { name: true } },
      },
    }),
    hubDb.mail_messages.findMany({
      orderBy: { id: "desc" },
      take: RECENT_MESSAGES_LIMIT,
      select: {
        id: true,
        kind: true,
        subject: true,
        body: true,
        created_at: true,
        from_user: { select: { username: true, title: true } },
      },
    }),
    hubDb.context_log.findMany({
      where: {
        type: "error",
        id: { gt: errorFloorId },
        created_at: { gte: since24h },
      },
      orderBy: { id: "desc" },
      take: ERROR_SCAN_LIMIT,
      select: {
        user_id: true,
        run_id: true,
        session_id: true,
        created_at: true,
        users: { select: { username: true, title: true } },
      },
    }),
    hubDb.user_notifications.findMany({
      where: { cost_suspended_reason: { not: null } },
      select: {
        cost_suspended_reason: true,
        users: { select: { username: true, title: true } },
      },
    }),
    hubDb.users.findMany({
      where: { next_run_at: { not: null }, enabled: true, archived: false },
      orderBy: { next_run_at: "asc" },
      take: UPCOMING_SCHEDULES_LIMIT,
      select: { username: true, title: true, next_run_at: true },
    }),
    getHosts(),
    getSpendLimitSettings(),
    getCostHistogram(since24h, now, 1),
    getCostsByAgent(since24h, now),
  ]);

  const recentRuns: DashboardRun[] = recentRunRows.map((r) => ({
    username: r.users.username,
    title: r.users.title,
    runId: r.run_id,
    sessionId: r.session_id,
    createdAt: r.created_at.toISOString(),
    lastActive: r.last_active.toISOString(),
    isOnline: isRunOnline(r.user_id, r.run_id, 0, r.session_id),
    modelName: r.model_name,
    totalTokens: r.total_tokens,
    totalCost: r.total_cost,
    triggeredBy: r.triggered_by,
    hostName: r.host?.name ?? null,
  }));

  const recentMessages: DashboardMessage[] = recentMessageRows.map((m) => ({
    id: m.id,
    kind: m.kind,
    fromUsername: m.from_user.username,
    fromTitle: m.from_user.title,
    subject: m.subject,
    snippet: makeSnippet(m.body),
    createdAt: m.created_at.toISOString(),
  }));

  // Group the scanned error rows by run; rows are newest-first, so the first
  // row seen for a run carries its latest session and timestamp.
  const errorRunsByKey = new Map<string, DashboardErrorRun>();
  for (const e of errorLogRows) {
    const key = `${e.user_id}-${e.run_id}`;
    const existing = errorRunsByKey.get(key);
    if (existing) {
      existing.errorCount += 1;
    } else {
      errorRunsByKey.set(key, {
        username: e.users.username,
        title: e.users.title,
        runId: e.run_id,
        sessionId: e.session_id,
        errorCount: 1,
        lastErrorAt: e.created_at.toISOString(),
      });
    }
  }
  const errorRuns = Array.from(errorRunsByKey.values()).slice(
    0,
    ERROR_RUNS_LIMIT,
  );

  const suspendedAgents = suspendedRows.map((s) => ({
    username: s.users.username,
    title: s.users.title,
    reason: s.cost_suspended_reason ?? "",
  }));

  const upcomingSchedules = scheduleRows.flatMap((s) =>
    s.next_run_at
      ? [
          {
            username: s.username,
            title: s.title,
            nextRunAt: s.next_run_at.toISOString(),
          },
        ]
      : [],
  );

  const hosts = hostRows.map((h) => ({
    name: h.name,
    hostType: h.hostType,
    online: isHostConnected(h.id),
    agentCount: h.agentCount,
    platform: h.platform,
  }));

  return {
    generatedAt: now.toISOString(),
    stats: {
      agentsActive: agentRows.filter((a) => isAgentActive(a.id)).length,
      agentsTotal: agentRows.length,
      runsLast24h,
      spendLast24h: Math.round((spend24h._sum.cost ?? 0) * 100) / 100,
      tokensLast24h:
        (spend24h._sum.input_tokens ?? 0) + (spend24h._sum.output_tokens ?? 0),
      spendLimitDollars: spendLimits.spendLimitDollars,
      spendLimitHours: spendLimits.spendLimitHours,
    },
    suspendedAgents,
    recentRuns,
    recentMessages,
    upcomingSchedules,
    hosts,
    costSummary: {
      buckets,
      byAgent: byAgent.slice(0, TOP_AGENTS_LIMIT),
    },
    errorRuns,
  };
}

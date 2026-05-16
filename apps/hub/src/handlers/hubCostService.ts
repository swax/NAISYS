import {
  dbFieldsToLlmModel,
  dbSubagentIdToWire,
  LlmApiType,
  type ModelDbRow,
  parseSpendLimitsFromConfigJson,
} from "@naisys/common";
import {
  type CodexUsage,
  type DualLogger,
  fetchCodexUsage,
} from "@naisys/common-node";
import {
  type HubDatabaseService,
  type PrismaClient,
  sumUserCostsInPeriod,
} from "@naisys/hub-database";
import {
  type CostPushEntry,
  CostWriteRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";
import type { HubCodexAuthService } from "./hubCodexAuthService.js";
import type { HubConfigService } from "./hubConfigService.js";
import type { HubHeartbeatService } from "./hubHeartbeatService.js";

const SPEND_LIMIT_CHECK_INTERVAL_MS = 10_000;
const DEFAULT_CODEX_USAGE_LIMIT_PERCENT = 80;
const DEFAULT_CODEX_USAGE_CHECK_MINUTES = 5;
// Delay before the first codex usage check — long enough for agent heartbeats
// to land (so getActiveSessions() isn't empty), short enough that a hub
// restart can't leave an over-limit account running for a full interval.
const INITIAL_CODEX_USAGE_CHECK_MS = 30_000;

/** Handles cost_write events from NAISYS instances (fire-and-forget) */
export function createHubCostService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  heartbeatService: HubHeartbeatService,
  configService: HubConfigService,
  codexAuthService: HubCodexAuthService,
) {
  // Suspended users → original suspension reason. Stored so a defensive
  // re-send (when a suspended user keeps writing costs) can use the same text.
  const suspendedByGlobal = new Map<number, string>();
  const suspendedByAgent = new Map<number, string>();
  // Codex OAuth agents suspended on account usage, not dollars — codex OAuth
  // has no per-request cost signal, only account-wide usage windows.
  const suspendedByCodexUsage = new Map<number, string>();

  naisysServer.registerEvent(
    HubEvents.COST_WRITE,
    async (hostId, data, ack) => {
      try {
        const parsed = CostWriteRequestSchema.parse(data);

        // Roll up cost deltas by user/run/session for supervisor push,
        // and per-user totals for budget_left decrement
        const costPushMap = new Map<string, CostPushEntry>();
        const userCostTotals = new Map<number, number>();

        for (const entry of parsed.entries) {
          const subagentId = entry.subagentId ?? 0;
          const wireSubagentId = dbSubagentIdToWire(subagentId);

          await hubDb.costs.create({
            data: {
              user_id: entry.userId,
              run_id: entry.runId,
              subagent_id: subagentId,
              session_id: entry.sessionId,
              host_id: hostId,
              source: entry.source,
              model: entry.model,
              cost: entry.cost,
              input_tokens: entry.inputTokens,
              output_tokens: entry.outputTokens,
              cache_write_tokens: entry.cacheWriteTokens,
              cache_read_tokens: entry.cacheReadTokens,
            },
          });

          // Update run_session total_cost
          await hubDb.run_session.updateMany({
            where: {
              user_id: entry.userId,
              run_id: entry.runId,
              subagent_id: subagentId,
              session_id: entry.sessionId,
            },
            data: {
              total_cost: { increment: entry.cost },
            },
          });

          const key = `${entry.userId}:${entry.runId}:${subagentId}:${entry.sessionId}`;
          const existing = costPushMap.get(key);
          if (existing) {
            existing.costDelta += entry.cost;
          } else {
            costPushMap.set(key, {
              userId: entry.userId,
              runId: entry.runId,
              subagentId: wireSubagentId,
              sessionId: entry.sessionId,
              costDelta: entry.cost,
            });
          }

          userCostTotals.set(
            entry.userId,
            (userCostTotals.get(entry.userId) ?? 0) + entry.cost,
          );
        }

        // Push rolled-up cost deltas to supervisor connections
        if (costPushMap.size > 0) {
          naisysServer.broadcastToSupervisors(HubEvents.COST_PUSH, {
            entries: Array.from(costPushMap.values()),
          });
        }

        // Re-send cost_control to suspended users still writing costs, using
        // whichever reason currently has priority.
        for (const userId of userCostTotals.keys()) {
          const reason = effectiveSuspensionReason(userId);
          if (reason !== undefined) {
            sendCostControl(userId, false, reason);
          }
        }

        // Decrement budget_left and return updated values
        const budgets = await Promise.all(
          Array.from(userCostTotals.entries()).map(([userId, batchCost]) =>
            decrementBudgetLeft(hubDb, userId, batchCost),
          ),
        );
        ack({ budgets });
      } catch (error) {
        logService.error(
          `[Hub:Costs] Error processing cost_write from host ${hostId}: ${error}`,
        );
        ack({ budgets: [] });
      }
    },
  );

  // Periodic spend limit checking
  const spendLimitCheckInterval = setInterval(
    () =>
      void checkSpendLimits().catch((error) => {
        logService.error(`[Hub:Costs] Error in spend limit check: ${error}`);
      }),
    SPEND_LIMIT_CHECK_INTERVAL_MS,
  );

  // Periodic OpenAI Codex usage check. Self-scheduling (not setInterval) so it
  // picks up CODEX_USAGE_CHECK_MINUTES changes without being recreated.
  let codexUsageTimer: ReturnType<typeof setTimeout> | undefined;
  let codexUsageStopped = false;

  function codexUsageIntervalMs() {
    return (
      (configService.getConfig().config?.codexUsageCheckMinutes ??
        DEFAULT_CODEX_USAGE_CHECK_MINUTES) * 60_000
    );
  }

  function scheduleCodexUsageCheck(delayMs: number) {
    if (codexUsageStopped) return;
    codexUsageTimer = setTimeout(() => {
      void checkCodexUsage()
        .catch((error) => {
          logService.error(`[Hub:Costs] Error in codex usage check: ${error}`);
        })
        .finally(() => scheduleCodexUsageCheck(codexUsageIntervalMs()));
    }, delayMs);
  }
  // First check runs soon after startup rather than a full interval later, but
  // never later than the configured interval (keeps short test intervals fast).
  scheduleCodexUsageCheck(
    Math.min(INITIAL_CODEX_USAGE_CHECK_MS, codexUsageIntervalMs()),
  );

  async function checkSpendLimits(candidateUserIds?: Iterable<number>) {
    const activeUserIds = heartbeatService.getActiveUserIds();
    const usersToCheck = new Set(activeUserIds);
    for (const userId of suspendedByGlobal.keys()) usersToCheck.add(userId);
    for (const userId of suspendedByAgent.keys()) usersToCheck.add(userId);
    if (candidateUserIds) {
      for (const userId of candidateUserIds) usersToCheck.add(userId);
    }
    if (usersToCheck.size === 0) return;

    const config = configService.getConfig().config;
    const spendLimitDollars = config?.spendLimitDollars;
    const spendLimitHours = config?.spendLimitHours;

    // Query user configs (needed by both global and per-agent checks)
    const users = await hubDb.users.findMany({
      where: { id: { in: Array.from(usersToCheck) } },
      select: {
        id: true,
        config: true,
        user_notifications: {
          select: { spend_limit_reset_at: true },
        },
      },
    });

    // Identify which users have per-agent spend limits (exempt from global)
    const usersWithAgentLimit = new Set<number>();
    for (const user of users) {
      if (
        parseSpendLimitsFromConfigJson(user.config).spendLimitDollars !==
        undefined
      ) {
        usersWithAgentLimit.add(user.id);
      }
    }

    // 1. Global spend limit — only applies to agents WITHOUT a per-agent limit
    if (spendLimitDollars !== undefined) {
      await checkGlobalSpendLimit(
        hubDb,
        usersToCheck,
        spendLimitDollars,
        spendLimitHours,
        usersWithAgentLimit,
      );
    }

    // 2. Per-agent spend limit checks
    for (const user of users) {
      try {
        const { spendLimitDollars, spendLimitHours } =
          parseSpendLimitsFromConfigJson(user.config);
        if (spendLimitDollars === undefined) continue;

        await checkAgentSpendLimit(
          hubDb,
          user.id,
          spendLimitDollars,
          spendLimitHours,
          user.user_notifications?.spend_limit_reset_at ?? undefined,
        );
      } catch (userError) {
        logService.error(
          `[Hub:Costs] Error checking spend limit for user ${user.id}: ${userError}`,
        );
      }
    }
  }

  function sendCostControl(userId: number, enabled: boolean, reason: string) {
    const hostIds = heartbeatService.findHostsForAgent(userId);

    for (const hostId of hostIds) {
      naisysServer.sendMessage(hostId, HubEvents.COST_CONTROL, {
        userId,
        enabled,
        reason,
      });
    }
  }

  async function setCostSuspendedReason(
    hubDb: PrismaClient,
    userId: number,
    reason: string | null,
  ) {
    await hubDb.user_notifications.updateMany({
      where: { user_id: userId },
      data: { cost_suspended_reason: reason },
    });
  }

  /**
   * The user's effective suspension reason, or undefined if not suspended.
   * Spend-limit and codex-usage suspensions can overlap on one agent; this is
   * the single source of truth for which reason wins — codex usage >
   * per-agent limit > global limit.
   */
  function effectiveSuspensionReason(userId: number): string | undefined {
    return (
      suspendedByCodexUsage.get(userId) ??
      suspendedByAgent.get(userId) ??
      suspendedByGlobal.get(userId)
    );
  }

  /**
   * Pushes the user's *effective* suspension state to both the agent
   * (cost_control) and the DB. If any map still holds them, the
   * highest-priority reason is sent/persisted — so a lower-priority change
   * can't leave the agent or UI showing a stale cause. `transitionReason` is
   * the informational text attached to the resume when nothing holds them.
   */
  async function pushSuspensionState(userId: number, transitionReason: string) {
    const effective = effectiveSuspensionReason(userId);
    if (effective !== undefined) {
      sendCostControl(userId, false, effective);
      await setCostSuspendedReason(hubDb, userId, effective);
    } else {
      sendCostControl(userId, true, transitionReason);
      await setCostSuspendedReason(hubDb, userId, null);
    }
  }

  /** Records a suspension in `ownMap`, then pushes the effective state. */
  async function suspendUser(
    userId: number,
    reason: string,
    ownMap: Map<number, string>,
  ) {
    ownMap.set(userId, reason);
    await pushSuspensionState(userId, reason);
  }

  /** Clears a suspension from `ownMap`, then pushes the effective state. */
  async function resumeUser(
    userId: number,
    reason: string,
    ownMap: Map<number, string>,
  ) {
    ownMap.delete(userId);
    await pushSuspensionState(userId, reason);
  }

  /** Check the global spend limit — only applies to agents without a per-agent limit */
  async function checkGlobalSpendLimit(
    hubDb: PrismaClient,
    usersToCheck: Set<number>,
    spendLimit: number,
    spendLimitHours: number | undefined,
    usersWithAgentLimit: Set<number>,
  ) {
    const totalCost = await sumUserCostsInPeriod(hubDb, { spendLimitHours });
    const isOverLimit = totalCost >= spendLimit;

    async function resumeFromGlobal(userId: number, reason: string) {
      logService.log(
        `[Hub:Costs] Resuming user ${userId} (global limit): ${reason}`,
      );
      await resumeUser(userId, reason, suspendedByGlobal);
    }

    for (const userId of usersToCheck) {
      // Agents with their own spend limit are exempt from the global limit
      if (usersWithAgentLimit.has(userId)) {
        if (suspendedByGlobal.has(userId)) {
          await resumeFromGlobal(userId, "Agent has per-agent spend limit");
        }
        continue;
      }

      const wasSuspended = suspendedByGlobal.has(userId);

      if (isOverLimit && !wasSuspended) {
        const reason = `Global spend limit of $${spendLimit} reached (total: $${totalCost.toFixed(2)})`;
        logService.log(
          `[Hub:Costs] Suspending user ${userId} (global limit): ${reason}`,
        );
        await suspendUser(userId, reason, suspendedByGlobal);
      } else if (!isOverLimit && wasSuspended) {
        await resumeFromGlobal(
          userId,
          `Global spend limit period reset (total: $${totalCost.toFixed(2)}, limit: $${spendLimit})`,
        );
      }
    }
  }

  /** Check a per-agent spend limit */
  async function checkAgentSpendLimit(
    hubDb: PrismaClient,
    userId: number,
    spendLimit: number,
    spendLimitHours: number | undefined,
    spendLimitResetAt?: Date,
  ) {
    const periodCost = await sumUserCostsInPeriod(hubDb, {
      userId,
      spendLimitHours,
      spendLimitResetAt,
    });
    const isOverLimit = periodCost >= spendLimit;
    const wasSuspended = suspendedByAgent.has(userId);

    // Persist budget_left for supervisor display
    const budgetLeft = Math.max(0, spendLimit - periodCost);
    await hubDb.user_notifications.updateMany({
      where: { user_id: userId },
      data: { budget_left: budgetLeft },
    });

    if (isOverLimit && !wasSuspended) {
      const reason = `Spend limit of $${spendLimit} reached (current: $${periodCost.toFixed(2)})`;
      logService.log(`[Hub:Costs] Suspending user ${userId}: ${reason}`);
      await suspendUser(userId, reason, suspendedByAgent);
    } else if (!isOverLimit && wasSuspended) {
      const reason = `Spend limit period reset (current: $${periodCost.toFixed(2)}, limit: $${spendLimit})`;
      logService.log(`[Hub:Costs] Resuming user ${userId}: ${reason}`);
      await resumeUser(userId, reason, suspendedByAgent);
    }
  }

  /** Decrement budget_left by the batch cost and return the updated value */
  async function decrementBudgetLeft(
    hubDb: PrismaClient,
    userId: number,
    batchCost: number,
  ): Promise<{ userId: number; budgetLeft: number | null }> {
    try {
      const notification = await hubDb.user_notifications.findUnique({
        where: { user_id: userId },
        select: { budget_left: true },
      });
      if (notification?.budget_left == null) {
        return { userId, budgetLeft: null };
      }

      const budgetLeft = Math.max(
        0,
        Number(notification.budget_left) - batchCost,
      );
      await hubDb.user_notifications.update({
        where: { user_id: userId },
        data: { budget_left: budgetLeft },
      });
      return { userId, budgetLeft };
    } catch {
      return { userId, budgetLeft: null };
    }
  }

  /** Resolve which active users are running an OpenAI Codex OAuth model. */
  async function findCodexOAuthUsers(): Promise<Set<number>> {
    const activeSessions = heartbeatService.getActiveSessions();
    if (activeSessions.length === 0) return new Set();

    // Classify off run_session.model_name for the *currently active* sessions
    // only: run_session rows are never deleted, so an `IN (user_ids)` query
    // would also match a user's stale historical rows. The agent resolves
    // templates like "${env.SHELL_MODEL}" before agent_start and the hub
    // patches the resolved name here; users.config.shellModel can still hold
    // an unresolved template, so it isn't usable.
    const sessions = await hubDb.run_session.findMany({
      where: {
        OR: activeSessions.map((s) => ({
          user_id: s.userId,
          run_id: s.runId,
          subagent_id: s.subagentId ?? 0,
          session_id: s.sessionId,
        })),
      },
      select: { user_id: true, model_name: true },
    });
    if (sessions.length === 0) return new Set();

    // Narrow the distinct model keys to the OpenAI Codex OAuth ones.
    const modelKeys = [...new Set(sessions.map((s) => s.model_name))];
    const modelRows = (await hubDb.models.findMany({
      where: { key: { in: modelKeys } },
    })) as ModelDbRow[];
    const codexModelKeys = new Set<string>();
    for (const row of modelRows) {
      if (row.type !== "llm") continue;
      try {
        if (dbFieldsToLlmModel(row).apiType === LlmApiType.OpenAIOAuth) {
          codexModelKeys.add(row.key);
        }
      } catch {
        /* ignore unparseable model meta */
      }
    }

    // A user counts as Codex if ANY of their sessions runs a Codex OAuth
    // model — a parent and its subagents heartbeat under the same user_id but
    // can run different models, so the parent's model alone isn't enough.
    const codexUserIds = new Set<number>();
    for (const session of sessions) {
      if (codexModelKeys.has(session.model_name)) {
        codexUserIds.add(session.user_id);
      }
    }
    return codexUserIds;
  }

  function formatUsagePercents(usage: CodexUsage): string {
    const parts: string[] = [];
    const primary = usage.primaryWindow?.usedPercent;
    const secondary = usage.secondaryWindow?.usedPercent;
    if (primary !== undefined) parts.push(`primary: ${primary.toFixed(0)}%`);
    if (secondary !== undefined) {
      parts.push(`secondary: ${secondary.toFixed(0)}%`);
    }
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
  }

  /** Resume codex-suspended users matching `predicate`, clearing the map. */
  async function resumeCodexSuspended(
    reason: string,
    predicate: (userId: number) => boolean,
  ) {
    for (const userId of [...suspendedByCodexUsage.keys()]) {
      if (!predicate(userId)) continue;
      logService.log(
        `[Hub:Costs] Resuming user ${userId} (codex usage): ${reason}`,
      );
      await resumeUser(userId, reason, suspendedByCodexUsage);
    }
  }

  /**
   * Poll OpenAI Codex account usage and suspend/resume codex OAuth agents.
   * The refresh token (and thus the usage limit) is account-global, so
   * suspension is all-or-nothing across every active codex agent.
   */
  async function checkCodexUsage() {
    const codexUserIds = await findCodexOAuthUsers();

    // Release anyone we suspended who's no longer running a codex model — a
    // model switch, or the agent simply stopped. resumeCodexSuspended walks
    // the suspended map directly, so stopped agents are cleared here too and
    // isUserSpendSuspended() can't stick.
    await resumeCodexSuspended(
      "no longer running an OpenAI Codex model",
      (userId) => !codexUserIds.has(userId),
    );

    if (codexUserIds.size === 0) return;

    // Mint a token via the shared single-flight provider, then ask OpenAI for
    // the account's usage windows.
    const token = await codexAuthService.getAccessToken();
    if (!token) {
      // Codex is no longer configured (refresh token removed) — nothing left
      // to enforce, so release anything still held by codex usage.
      await resumeCodexSuspended("OpenAI Codex is no longer configured", () =>
        true,
      );
      return;
    }

    const usage = await fetchCodexUsage({
      accessToken: token.accessToken,
    });

    const limitPercent =
      configService.getConfig().config?.codexUsageLimitPercent ??
      DEFAULT_CODEX_USAGE_LIMIT_PERCENT;
    const primaryPct = usage.primaryWindow?.usedPercent;
    const secondaryPct = usage.secondaryWindow?.usedPercent;
    const isOverLimit =
      usage.limitReached === true ||
      (primaryPct !== undefined && primaryPct >= limitPercent) ||
      (secondaryPct !== undefined && secondaryPct >= limitPercent);

    const percents = formatUsagePercents(usage);
    const suspendReason =
      usage.limitReached === true
        ? `OpenAI Codex usage limit reached${percents}`
        : `OpenAI Codex usage at/over ${limitPercent}%${percents}`;
    const resumeReason = `OpenAI Codex usage back under limit${percents}`;

    for (const userId of codexUserIds) {
      const wasSuspended = suspendedByCodexUsage.has(userId);
      if (isOverLimit && !wasSuspended) {
        logService.log(
          `[Hub:Costs] Suspending user ${userId} (codex usage): ${suspendReason}`,
        );
        await suspendUser(userId, suspendReason, suspendedByCodexUsage);
      } else if (!isOverLimit && wasSuspended) {
        logService.log(
          `[Hub:Costs] Resuming user ${userId} (codex usage): ${resumeReason}`,
        );
        await resumeUser(userId, resumeReason, suspendedByCodexUsage);
      }
    }
  }

  function isUserSpendSuspended(userId: number) {
    return effectiveSuspensionReason(userId) !== undefined;
  }

  function cleanup() {
    clearInterval(spendLimitCheckInterval);
    codexUsageStopped = true;
    if (codexUsageTimer) clearTimeout(codexUsageTimer);
  }

  return {
    cleanup,
    checkSpendLimits,
    isUserSpendSuspended,
  };
}

export type HubCostService = ReturnType<typeof createHubCostService>;

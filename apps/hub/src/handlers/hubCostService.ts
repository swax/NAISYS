import {
  AgentConfigFileSchema,
  calculatePeriodBoundaries,
} from "@naisys/common";
import type { HubDatabaseService } from "@naisys/hub-database";
import type { PrismaClient } from "@naisys/hub-database";
import {
  type CostPushEntry,
  CostWriteRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";

import type { DualLogger } from "@naisys/common-node";
import type { NaisysServer } from "../services/naisysServer.js";
import type { HubConfigService } from "./hubConfigService.js";
import type { HubHeartbeatService } from "./hubHeartbeatService.js";

const SPEND_LIMIT_CHECK_INTERVAL_MS = 10_000;

/** Handles cost_write events from NAISYS instances (fire-and-forget) */
export function createHubCostService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  heartbeatService: HubHeartbeatService,
  configService: HubConfigService,
) {
  // Track which users have been suspended due to spend limit overrun
  const suspendedByGlobal = new Set<number>();
  const suspendedByAgent = new Set<number>();

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
          await hubDb.costs.create({
            data: {
              user_id: entry.userId,
              run_id: entry.runId,
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
              session_id: entry.sessionId,
            },
            data: {
              total_cost: { increment: entry.cost },
            },
          });

          const key = `${entry.userId}:${entry.runId}:${entry.sessionId}`;
          const existing = costPushMap.get(key);
          if (existing) {
            existing.costDelta += entry.cost;
          } else {
            costPushMap.set(key, {
              userId: entry.userId,
              runId: entry.runId,
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

        // Re-send cost_control to any suspended users still writing costs
        for (const userId of userCostTotals.keys()) {
          if (suspendedByGlobal.has(userId) || suspendedByAgent.has(userId)) {
            sendCostControl(userId, false, "Spend limit exceeded");
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

  async function checkSpendLimits(candidateUserIds?: Iterable<number>) {
    const activeUserIds = heartbeatService.getActiveUserIds();
    const usersToCheck = new Set(activeUserIds);
    for (const userId of suspendedByGlobal) usersToCheck.add(userId);
    for (const userId of suspendedByAgent) usersToCheck.add(userId);
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
      try {
        const parsed = AgentConfigFileSchema.safeParse(JSON.parse(user.config));
        if (parsed.success && parsed.data.spendLimitDollars !== undefined) {
          usersWithAgentLimit.add(user.id);
        }
      } catch {
        /* ignore parse errors */
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
        const parsed = AgentConfigFileSchema.safeParse(JSON.parse(user.config));
        if (!parsed.success) continue;

        const config = parsed.data;
        if (config.spendLimitDollars === undefined) continue;

        await checkAgentSpendLimit(
          hubDb,
          user.id,
          config.spendLimitDollars,
          config.spendLimitHours,
          user.user_notifications?.spend_limit_reset_at ?? undefined,
        );
      } catch (userError) {
        logService.error(
          `[Hub:Costs] Error checking spend limit for user ${user.id}: ${userError}`,
        );
      }
    }
  }

  /**
   * Finds the total cost over the period, if this period is used up, we wait until the next period to resume.
   * We don't use a sliding window as that would cause the LLM to get stuck in a cycle of sending off a query,
   * only for the window to close again, and the LLM cache to *expire* creating constant cache misses.
   */
  async function queryCostSum(
    hubDb: PrismaClient,
    spendLimitHours: number | undefined,
    userIdFilter?: number,
    spendLimitResetAt?: Date,
  ): Promise<number> {
    const where: Record<string, unknown> = {};
    if (userIdFilter) {
      where.user_id = userIdFilter;
    }

    let effectiveStart: Date | undefined;
    if (spendLimitHours !== undefined) {
      const { periodStart } = calculatePeriodBoundaries(spendLimitHours);
      effectiveStart = periodStart;
    }
    if (
      spendLimitResetAt &&
      (!effectiveStart || spendLimitResetAt > effectiveStart)
    ) {
      effectiveStart = spendLimitResetAt;
    }
    if (effectiveStart) {
      where.created_at = { gte: effectiveStart };
    }

    const result = await hubDb.costs.aggregate({
      where,
      _sum: { cost: true },
    });
    return result._sum.cost ?? 0;
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

  /** Check the global spend limit — only applies to agents without a per-agent limit */
  async function checkGlobalSpendLimit(
    hubDb: PrismaClient,
    usersToCheck: Set<number>,
    spendLimit: number,
    spendLimitHours: number | undefined,
    usersWithAgentLimit: Set<number>,
  ) {
    const totalCost = await queryCostSum(hubDb, spendLimitHours);
    const isOverLimit = totalCost >= spendLimit;

    async function resumeFromGlobal(userId: number, reason: string) {
      logService.log(
        `[Hub:Costs] Resuming user ${userId} (global limit): ${reason}`,
      );
      sendCostControl(userId, true, reason);
      suspendedByGlobal.delete(userId);
      if (!suspendedByAgent.has(userId)) {
        await setCostSuspendedReason(hubDb, userId, null);
      }
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
        sendCostControl(userId, false, reason);
        suspendedByGlobal.add(userId);
        await setCostSuspendedReason(hubDb, userId, reason);
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
    const periodCost = await queryCostSum(
      hubDb,
      spendLimitHours,
      userId,
      spendLimitResetAt,
    );
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
      sendCostControl(userId, false, reason);
      suspendedByAgent.add(userId);
      await setCostSuspendedReason(hubDb, userId, reason);
    } else if (!isOverLimit && wasSuspended) {
      const reason = `Spend limit period reset (current: $${periodCost.toFixed(2)}, limit: $${spendLimit})`;
      logService.log(`[Hub:Costs] Resuming user ${userId}: ${reason}`);
      sendCostControl(userId, true, reason);
      suspendedByAgent.delete(userId);
      await setCostSuspendedReason(hubDb, userId, null);
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

  function isUserSpendSuspended(userId: number) {
    return suspendedByGlobal.has(userId) || suspendedByAgent.has(userId);
  }

  function cleanup() {
    clearInterval(spendLimitCheckInterval);
  }

  return {
    cleanup,
    checkSpendLimits,
    isUserSpendSuspended,
  };
}

export type HubCostService = ReturnType<typeof createHubCostService>;

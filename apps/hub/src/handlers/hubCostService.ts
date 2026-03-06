import {
  AgentConfigFileSchema,
  calculatePeriodBoundaries,
  COST_AGGREGATION_WINDOW_MS,
} from "@naisys/common";
import type { HubDatabaseService } from "@naisys/hub-database";
import { PrismaClient } from "@naisys/hub-database";
import {
  type CostPushEntry,
  CostWriteRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";

import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubConfigService } from "./hubConfigService.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";

const SPEND_LIMIT_CHECK_INTERVAL_MS = 10_000;

/** Handles cost_write events from NAISYS instances (fire-and-forget) */
export function createHubCostService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
  configService: HubConfigService,
) {
  // Track which users have been suspended due to spend limit overrun
  const suspendedByGlobal = new Set<number>();
  const suspendedByAgent = new Set<number>();

  naisysServer.registerEvent(HubEvents.COST_WRITE, async (hostId, data) => {
    try {
      const parsed = CostWriteRequestSchema.parse(data);

      // Collect unique user IDs from this batch
      const batchUserIds = new Set(parsed.entries.map((e) => e.userId));
      const costPushEntries: CostPushEntry[] = [];

      for (const entry of parsed.entries) {
        // Find the most recent cost record for this combination
        const existingRecord = await hubDb.costs.findFirst({
          where: {
            user_id: entry.userId,
            run_id: entry.runId,
            session_id: entry.sessionId,
            source: entry.source,
            model: entry.model,
          },
          orderBy: { created_at: "desc" },
          select: { id: true, created_at: true },
        });

        // Update existing record if within aggregation window, otherwise create new
        if (
          existingRecord &&
          Date.now() - existingRecord.created_at.getTime() <
            COST_AGGREGATION_WINDOW_MS
        ) {
          await hubDb.costs.update({
            where: { id: existingRecord.id },
            data: {
              cost: { increment: entry.cost },
              input_tokens: { increment: entry.inputTokens },
              output_tokens: { increment: entry.outputTokens },
              cache_write_tokens: { increment: entry.cacheWriteTokens },
              cache_read_tokens: { increment: entry.cacheReadTokens },
            },
          });
        } else {
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
        }

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

        costPushEntries.push({
          userId: entry.userId,
          runId: entry.runId,
          sessionId: entry.sessionId,
          costDelta: entry.cost,
        });
      }

      // Push cost deltas to supervisor connections
      if (costPushEntries.length > 0) {
        for (const connection of naisysServer.getConnectedClients()) {
          if (connection.getHostType() !== "supervisor") continue;
          naisysServer.sendMessage(
            connection.getHostId(),
            HubEvents.COST_PUSH,
            { entries: costPushEntries },
          );
        }
      }

      // Re-send cost_control to any suspended users still writing costs
      for (const userId of batchUserIds) {
        if (suspendedByGlobal.has(userId) || suspendedByAgent.has(userId)) {
          sendCostControl(userId, false, "Spend limit exceeded");
        }
      }
    } catch (error) {
      logService.error(
        `[Hub:Costs] Error processing cost_write from host ${hostId}: ${error}`,
      );
    }
  });

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

    // 1. Global spend limit check — costs across ALL agents
    if (spendLimitDollars !== undefined) {
      await checkGlobalSpendLimit(
        hubDb,
        usersToCheck,
        spendLimitDollars,
        spendLimitHours,
      );
    }

    // 2. Per-agent spend limit checks — costs for individual agents
    const users = await hubDb.users.findMany({
      where: { id: { in: Array.from(usersToCheck) } },
      select: { id: true, config: true },
    });

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
  ): Promise<number> {
    const where: Record<string, unknown> = {};
    if (userIdFilter) {
      where.user_id = userIdFilter;
    }

    if (spendLimitHours !== undefined) {
      const { periodStart } = calculatePeriodBoundaries(spendLimitHours);
      where.created_at = { gte: periodStart };
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

  /** Check the global spend limit across all agents */
  async function checkGlobalSpendLimit(
    hubDb: PrismaClient,
    usersToCheck: Set<number>,
    spendLimit: number,
    spendLimitHours: number | undefined,
  ) {
    const totalCost = await queryCostSum(hubDb, spendLimitHours);
    const isOverLimit = totalCost >= spendLimit;

    for (const userId of usersToCheck) {
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
        const reason = `Global spend limit period reset (total: $${totalCost.toFixed(2)}, limit: $${spendLimit})`;
        logService.log(
          `[Hub:Costs] Resuming user ${userId} (global limit): ${reason}`,
        );
        sendCostControl(userId, true, reason);
        suspendedByGlobal.delete(userId);
        // Only clear DB reason if not also suspended by per-agent limit
        if (!suspendedByAgent.has(userId)) {
          await setCostSuspendedReason(hubDb, userId, null);
        }
      }
    }
  }

  /** Check a per-agent spend limit */
  async function checkAgentSpendLimit(
    hubDb: PrismaClient,
    userId: number,
    spendLimit: number,
    spendLimitHours: number | undefined,
  ) {
    const periodCost = await queryCostSum(hubDb, spendLimitHours, userId);
    const isOverLimit = periodCost >= spendLimit;
    const wasSuspended = suspendedByAgent.has(userId);

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
      // Only clear DB reason if not also suspended by global limit
      if (!suspendedByGlobal.has(userId)) {
        await setCostSuspendedReason(hubDb, userId, null);
      }
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

import {
  AgentConfigFileSchema,
  calculatePeriodBoundaries,
  COST_AGGREGATION_WINDOW_MS,
  sanitizeSpendLimit,
} from "@naisys/common";
import { DatabaseService, PrismaClient } from "@naisys/database";
import {
  CostControl,
  CostWriteRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import yaml from "js-yaml";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";

const SPEND_LIMIT_CHECK_INTERVAL_MS = 10_000;

/** Handles cost_write events from NAISYS instances (fire-and-forget) */
export function createHubCostService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
) {
  // Track which users have been suspended due to spend limit overrun
  const suspendedByGlobal = new Set<number>();
  const suspendedByAgent = new Set<number>();

  const spendLimitDollars = sanitizeSpendLimit(process.env.SPEND_LIMIT_DOLLARS);
  const spendLimitHours = sanitizeSpendLimit(process.env.SPEND_LIMIT_HOURS);

  naisysServer.registerEvent(
    HubEvents.COST_WRITE,
    async (hostId: number, data: unknown) => {
      try {
        const parsed = CostWriteRequestSchema.parse(data);

        // Collect unique user IDs from this batch
        const batchUserIds = new Set(parsed.entries.map((e) => e.userId));

        await dbService.usingDatabase(async (prisma) => {
          for (const entry of parsed.entries) {
            // Find the most recent cost record for this combination
            const existingRecord = await prisma.costs.findFirst({
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
              await prisma.costs.update({
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
              await prisma.costs.create({
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
            await prisma.run_session.updateMany({
              where: {
                user_id: entry.userId,
                run_id: entry.runId,
                session_id: entry.sessionId,
              },
              data: {
                total_cost: { increment: entry.cost },
              },
            });
          }
        });

        // Re-send cost_control to any suspended users still writing costs
        for (const userId of batchUserIds) {
          if (suspendedByGlobal.has(userId) || suspendedByAgent.has(userId)) {
            sendCostControl(userId, false, "Spend limit exceeded");
          }
        }
      } catch (error) {
        logService.error(
          `[HubCostService] Error processing cost_write from host ${hostId}: ${error}`,
        );
      }
    },
  );

  // Periodic spend limit checking
  const spendLimitCheckInterval = setInterval(
    () => void checkSpendLimits(),
    SPEND_LIMIT_CHECK_INTERVAL_MS,
  );

  async function checkSpendLimits() {
    try {
      const activeUserIds = heartbeatService.getActiveUserIds();
      if (activeUserIds.size === 0) return;

      await dbService.usingDatabase(async (prisma) => {
        // 1. Global spend limit check — costs across ALL agents
        if (spendLimitDollars !== undefined) {
          await checkGlobalSpendLimit(
            prisma,
            activeUserIds,
            spendLimitDollars,
            spendLimitHours,
          );
        }

        // 2. Per-agent spend limit checks — costs for individual agents
        const users = await prisma.users.findMany({
          where: { id: { in: Array.from(activeUserIds) } },
          select: { id: true, config: true },
        });

        for (const user of users) {
          try {
            const parsed = AgentConfigFileSchema.safeParse(
              yaml.load(user.config),
            );
            if (!parsed.success) continue;

            const config = parsed.data;
            if (config.spendLimitDollars === undefined) continue;

            await checkAgentSpendLimit(
              prisma,
              user.id,
              config.spendLimitDollars,
              config.spendLimitHours,
            );
          } catch (userError) {
            logService.error(
              `[HubCostService] Error checking spend limit for user ${user.id}: ${userError}`,
            );
          }
        }
      });
    } catch (error) {
      logService.error(`[HubCostService] Error in spend limit check: ${error}`);
    }
  }

  async function queryCostSum(
    prisma: PrismaClient,
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

    const result = await prisma.costs.aggregate({
      where,
      _sum: { cost: true },
    });
    return result._sum.cost ?? 0;
  }

  function sendCostControl(userId: number, enabled: boolean, reason: string) {
    const hostIds = heartbeatService.findHostsForAgent(userId);

    for (const hostId of hostIds) {
      naisysServer.sendMessage<CostControl>(hostId, HubEvents.COST_CONTROL, {
        userId,
        enabled,
        reason,
      });
    }
  }

  /** Check the global spend limit across all agents */
  async function checkGlobalSpendLimit(
    prisma: PrismaClient,
    activeUserIds: Set<number>,
    spendLimit: number,
    spendLimitHours: number | undefined,
  ) {
    const totalCost = await queryCostSum(prisma, spendLimitHours);
    const isOverLimit = totalCost >= spendLimit;

    for (const userId of activeUserIds) {
      const wasSuspended = suspendedByGlobal.has(userId);

      if (isOverLimit && !wasSuspended) {
        const reason = `Global spend limit of $${spendLimit} reached (total: $${totalCost.toFixed(2)})`;
        logService.log(
          `[HubCostService] Suspending user ${userId} (global limit): ${reason}`,
        );
        sendCostControl(userId, false, reason);
        suspendedByGlobal.add(userId);
      } else if (!isOverLimit && wasSuspended) {
        const reason = `Global spend limit period reset (total: $${totalCost.toFixed(2)}, limit: $${spendLimit})`;
        logService.log(
          `[HubCostService] Resuming user ${userId} (global limit): ${reason}`,
        );
        sendCostControl(userId, true, reason);
        suspendedByGlobal.delete(userId);
      }
    }
  }

  /** Check a per-agent spend limit */
  async function checkAgentSpendLimit(
    prisma: PrismaClient,
    userId: number,
    spendLimit: number,
    spendLimitHours: number | undefined,
  ) {
    const periodCost = await queryCostSum(prisma, spendLimitHours, userId);
    const isOverLimit = periodCost >= spendLimit;
    const wasSuspended = suspendedByAgent.has(userId);

    if (isOverLimit && !wasSuspended) {
      const reason = `Spend limit of $${spendLimit} reached (current: $${periodCost.toFixed(2)})`;
      logService.log(`[HubCostService] Suspending user ${userId}: ${reason}`);
      sendCostControl(userId, false, reason);
      suspendedByAgent.add(userId);
    } else if (!isOverLimit && wasSuspended) {
      const reason = `Spend limit period reset (current: $${periodCost.toFixed(2)}, limit: $${spendLimit})`;
      logService.log(`[HubCostService] Resuming user ${userId}: ${reason}`);
      sendCostControl(userId, true, reason);
      suspendedByAgent.delete(userId);
    }
  }

  function cleanup() {
    clearInterval(spendLimitCheckInterval);
  }

  return { cleanup };
}

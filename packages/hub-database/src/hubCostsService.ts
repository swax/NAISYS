import { calculateEffectiveSpendStart } from "@naisys/common";

import type { PrismaClient } from "./generated/prisma/client.js";

/** Options for {@link sumUserCostsInPeriod}. */
export interface SumUserCostsInPeriodOptions {
  /** Filter to one user; omit to sum across all users (global cap). */
  userId?: number;
  /** Rolling-window length; omit for an all-time lifetime cap. */
  spendLimitHours?: number;
  /** Manual reset cursor (`user_notifications.spend_limit_reset_at`). When set
   *  and later than the period start derived from `spendLimitHours`, it
   *  overrides. */
  spendLimitResetAt?: Date;
}

/**
 * Sum recorded cost over a user's current spend window. Shared by the hub's
 * spend enforcement (per-agent and global) and the supervisor's voice budget
 * check. Takes a {@link PrismaClient} explicitly because both callers hold
 * their own.
 */
export async function sumUserCostsInPeriod(
  hubDb: PrismaClient,
  options: SumUserCostsInPeriodOptions = {},
): Promise<number> {
  const { userId, spendLimitHours, spendLimitResetAt } = options;
  const effectiveStart = calculateEffectiveSpendStart(
    spendLimitHours,
    spendLimitResetAt,
  );

  const result = await hubDb.costs.aggregate({
    _sum: { cost: true },
    where: {
      ...(userId !== undefined && { user_id: userId }),
      ...(effectiveStart && { created_at: { gte: effectiveStart } }),
    },
  });

  return result._sum.cost ?? 0;
}

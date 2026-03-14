import type { CostBucket, CostByAgent } from "@naisys-supervisor/shared";

import { hubDb } from "../database/hubDb.js";

export async function getSpendLimitSettings(): Promise<{
  spendLimitDollars: number | null;
  spendLimitHours: number | null;
}> {
  const vars = await hubDb.variables.findMany({
    where: { key: { in: ["SPEND_LIMIT_DOLLARS", "SPEND_LIMIT_HOURS"] } },
  });

  const dollarsVar = vars.find((v) => v.key === "SPEND_LIMIT_DOLLARS");
  const hoursVar = vars.find((v) => v.key === "SPEND_LIMIT_HOURS");

  return {
    spendLimitDollars: dollarsVar ? parseFloat(dollarsVar.value) || null : null,
    spendLimitHours: hoursVar ? parseFloat(hoursVar.value) || null : null,
  };
}

/** Find the lead user and all subordinates recursively */
export async function findUserIdsForLead(
  leadUsername: string,
): Promise<number[]> {
  const leadUser = await hubDb.users.findUnique({
    where: { username: leadUsername },
    select: { id: true },
  });
  if (!leadUser) return [];

  const allUsers = await hubDb.users.findMany({
    select: { id: true, lead_user_id: true },
  });

  const result = [leadUser.id];
  function collect(parentId: number) {
    for (const user of allUsers) {
      if (user.lead_user_id === parentId) {
        result.push(user.id);
        collect(user.id);
      }
    }
  }
  collect(leadUser.id);
  return result;
}

export async function getCostHistogram(
  start: Date,
  end: Date,
  bucketHours: number,
  userIds?: number[],
): Promise<CostBucket[]> {
  const where: Record<string, unknown> = {
    created_at: { gte: start, lte: end },
  };
  if (userIds) {
    where.user_id = { in: userIds };
  }

  const costs = await hubDb.costs.findMany({
    where,
    select: {
      cost: true,
      created_at: true,
      user_id: true,
    },
    orderBy: { created_at: "asc" },
  });

  // Collect unique user IDs and resolve usernames
  const costUserIds = new Set(costs.map((c) => c.user_id));
  const users =
    costUserIds.size > 0
      ? await hubDb.users.findMany({
          where: { id: { in: Array.from(costUserIds) } },
          select: { id: true, username: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u.username]));

  // Build buckets
  const bucketMs = bucketHours * 60 * 60 * 1000;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const buckets: CostBucket[] = [];

  for (
    let bucketStart = startMs;
    bucketStart < endMs;
    bucketStart += bucketMs
  ) {
    const bucketEnd = Math.min(bucketStart + bucketMs, endMs);
    buckets.push({
      start: new Date(bucketStart).toISOString(),
      end: new Date(bucketEnd).toISOString(),
      cost: 0,
      byAgent: {},
    });
  }

  // Fill buckets with costs
  for (const cost of costs) {
    const costMs = cost.created_at.getTime();
    const bucketIndex = Math.floor((costMs - startMs) / bucketMs);
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      const amount = cost.cost ?? 0;
      buckets[bucketIndex].cost += amount;
      const username = userMap.get(cost.user_id) ?? `user-${cost.user_id}`;
      buckets[bucketIndex].byAgent[username] =
        (buckets[bucketIndex].byAgent[username] ?? 0) + amount;
    }
  }

  return buckets;
}

export async function getCostsByAgent(
  start: Date,
  end: Date,
  userIds?: number[],
): Promise<CostByAgent[]> {
  const where: Record<string, unknown> = {
    created_at: { gte: start, lte: end },
  };
  if (userIds) {
    where.user_id = { in: userIds };
  }

  const costs = await hubDb.costs.findMany({
    where,
    select: {
      cost: true,
      user_id: true,
    },
  });

  // Aggregate by user_id
  const byUserId = new Map<number, number>();
  for (const c of costs) {
    byUserId.set(c.user_id, (byUserId.get(c.user_id) ?? 0) + (c.cost ?? 0));
  }

  if (byUserId.size === 0) return [];

  // Look up usernames
  const users = await hubDb.users.findMany({
    where: { id: { in: Array.from(byUserId.keys()) } },
    select: { id: true, username: true, title: true },
  });

  const userMap = new Map(
    users.map((u) => [u.id, { username: u.username, title: u.title }]),
  );

  return Array.from(byUserId.entries())
    .map(([userId, cost]) => {
      const user = userMap.get(userId);
      return {
        username: user?.username ?? `user-${userId}`,
        title: user?.title ?? "",
        cost: Math.round(cost * 100) / 100,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

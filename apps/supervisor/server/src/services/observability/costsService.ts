import { getOrInsert, keyBy, unique } from "@naisys/common";
import type {
  CostBucket,
  CostByAgent,
  CostByModel,
} from "@naisys/supervisor-shared";

import { hubDb } from "../../database/hubDb.js";

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
      model: true,
      input_tokens: true,
      output_tokens: true,
    },
    orderBy: { created_at: "asc" },
  });

  // Collect unique user IDs and resolve usernames
  const costUserIds = unique(costs.map((c) => c.user_id));
  const users =
    costUserIds.length > 0
      ? await hubDb.users.findMany({
          where: { id: { in: costUserIds } },
          select: { id: true, username: true },
        })
      : [];
  const userMap = keyBy(users, (u) => u.id);

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
      tokens: 0,
      byAgent: {},
      byModel: {},
      byAgentTokens: {},
      byModelTokens: {},
    });
  }

  // Fill buckets with costs
  for (const cost of costs) {
    const costMs = cost.created_at.getTime();
    const bucketIndex = Math.floor((costMs - startMs) / bucketMs);
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      const amount = cost.cost ?? 0;
      const tokens = (cost.input_tokens ?? 0) + (cost.output_tokens ?? 0);
      const bucket = buckets[bucketIndex];
      bucket.cost += amount;
      bucket.tokens += tokens;
      const username =
        userMap.get(cost.user_id)?.username ?? `user-${cost.user_id}`;
      bucket.byAgent[username] = (bucket.byAgent[username] ?? 0) + amount;
      bucket.byAgentTokens[username] =
        (bucket.byAgentTokens[username] ?? 0) + tokens;
      const modelName = cost.model || "unknown";
      bucket.byModel[modelName] = (bucket.byModel[modelName] ?? 0) + amount;
      bucket.byModelTokens[modelName] =
        (bucket.byModelTokens[modelName] ?? 0) + tokens;
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
      input_tokens: true,
      output_tokens: true,
    },
  });

  // Aggregate by user_id
  const byUserId = new Map<number, { cost: number; tokens: number }>();
  for (const c of costs) {
    const entry = getOrInsert(byUserId, c.user_id, () => ({
      cost: 0,
      tokens: 0,
    }));
    entry.cost += c.cost ?? 0;
    entry.tokens += (c.input_tokens ?? 0) + (c.output_tokens ?? 0);
  }

  if (byUserId.size === 0) return [];

  // Look up usernames
  const users = await hubDb.users.findMany({
    where: { id: { in: Array.from(byUserId.keys()) } },
    select: { id: true, username: true, title: true },
  });

  const userMap = keyBy(users, (u) => u.id);

  return Array.from(byUserId.entries())
    .map(([userId, totals]) => {
      const user = userMap.get(userId);
      return {
        username: user?.username ?? `user-${userId}`,
        title: user?.title ?? "",
        cost: Math.round(totals.cost * 100) / 100,
        tokens: totals.tokens,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

export async function getCostsByModel(
  start: Date,
  end: Date,
  userIds?: number[],
): Promise<CostByModel[]> {
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
      model: true,
      input_tokens: true,
      output_tokens: true,
    },
  });

  const byModel = new Map<string, { cost: number; tokens: number }>();
  for (const c of costs) {
    const modelName = c.model || "unknown";
    const entry = getOrInsert(byModel, modelName, () => ({
      cost: 0,
      tokens: 0,
    }));
    entry.cost += c.cost ?? 0;
    entry.tokens += (c.input_tokens ?? 0) + (c.output_tokens ?? 0);
  }

  return Array.from(byModel.entries())
    .map(([model, totals]) => ({
      model,
      cost: Math.round(totals.cost * 100) / 100,
      tokens: totals.tokens,
    }))
    .sort((a, b) => b.cost - a.cost);
}

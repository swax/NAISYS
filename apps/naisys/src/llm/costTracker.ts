import { createConfig } from "../config.js";
import { createDatabaseService } from "../services/dbService.js";
import { createOutputService } from "../utils/output.js";
import { createLLModels } from "./llModels.js";

// Keep only interfaces that are used as parameters or need explicit typing
interface LlmModelCosts {
  inputCost: number;
  outputCost: number;
  cacheWriteCost?: number;
  cacheReadCost?: number;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export function createCostTracker(
  config: Awaited<ReturnType<typeof createConfig>>,
  llModels: ReturnType<typeof createLLModels>,
  { usingDatabase, myUserId }: Awaited<ReturnType<typeof createDatabaseService>>,
  output: ReturnType<typeof createOutputService>,
) {
  // Record token usage for LLM calls - calculate and store total cost
  async function recordTokens(
    source: string,
    modelKey: string,
    inputTokens: number = 0,
    outputTokens: number = 0,
    cacheWriteTokens: number = 0,
    cacheReadTokens: number = 0,
  ) {
    // Calculate total cost from tokens - will throw if model not found
    const model = llModels.get(modelKey);
    const tokenUsage: TokenUsage = {
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
    };
    const totalCost = calculateCostFromTokens(tokenUsage, model);

    await usingDatabase(async (prisma) => {
      await prisma.costs.create({
        data: {
          date: new Date().toISOString(),
          user_id: myUserId,
          subagent: null,
          source,
          model: modelKey,
          cost: totalCost,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_write_tokens: cacheWriteTokens,
          cache_read_tokens: cacheReadTokens,
        },
      });
    });
  }

  // Record fixed cost for non-token services like image generation
  async function recordCost(cost: number, source: string, modelKey: string) {
    await usingDatabase(async (prisma) => {
      await prisma.costs.create({
        data: {
          date: new Date().toISOString(),
          user_id: myUserId,
          subagent: null,
          source,
          model: modelKey,
          cost,
          input_tokens: 0, // No tokens for fixed cost services
          output_tokens: 0,
          cache_write_tokens: 0,
          cache_read_tokens: 0,
        },
      });
    });
  }

  // Common function to calculate cost from token usage
  function calculateCostFromTokens(
    tokenUsage: TokenUsage,
    model: LlmModelCosts,
  ): number {
    const inputCost = (tokenUsage.inputTokens * model.inputCost) / 1_000_000;
    const outputCost = (tokenUsage.outputTokens * model.outputCost) / 1_000_000;
    const cacheWriteCost =
      (tokenUsage.cacheWriteTokens * (model.cacheWriteCost || 0)) / 1_000_000;
    const cacheReadCost =
      (tokenUsage.cacheReadTokens * (model.cacheReadCost || 0)) / 1_000_000;

    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  }

  async function getTotalCosts(userId?: number) {
    return usingDatabase(async (prisma) => {
      const where = userId ? { user_id: userId } : {};

      const result = await prisma.costs.aggregate({
        where,
        _sum: {
          cost: true,
        },
      });

      return Number(result._sum.cost || 0);
    });
  }

  async function getCostBreakdown(userId?: number) {
    return usingDatabase(async (prisma) => {
      const where = userId ? { user_id: userId } : {};

      const result = await prisma.costs.aggregate({
        where,
        _sum: {
          input_tokens: true,
          output_tokens: true,
          cache_write_tokens: true,
          cache_read_tokens: true,
        },
      });

      // Convert BigInt to Number for arithmetic operations
      const inputTokens = Number(result._sum.input_tokens || 0);
      const outputTokens = Number(result._sum.output_tokens || 0);
      const cacheWriteTokens = Number(result._sum.cache_write_tokens || 0);
      const cacheReadTokens = Number(result._sum.cache_read_tokens || 0);

      const totalCacheTokens = cacheWriteTokens + cacheReadTokens;
      const totalInputTokens = inputTokens + totalCacheTokens;

      return {
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        totalInputTokens,
        totalCacheTokens,
      };
    });
  }

  async function getCostBreakdownWithModels(userId?: number) {
    return usingDatabase(async (prisma) => {
      const result = await prisma.costs.groupBy({
        by: ["model"],
        ...(userId ? { where: { user_id: userId } } : {}),
        _sum: {
          cost: true,
          input_tokens: true,
          output_tokens: true,
          cache_write_tokens: true,
          cache_read_tokens: true,
        },
        orderBy: {
          _sum: {
            cost: "desc",
          },
        },
      });

      // Convert BigInt values to Number for compatibility
      return result.map((row) => ({
        model: row.model,
        total_cost: Number(row._sum.cost || 0),
        input_tokens: Number(row._sum.input_tokens || 0),
        output_tokens: Number(row._sum.output_tokens || 0),
        cache_write_tokens: Number(row._sum.cache_write_tokens || 0),
        cache_read_tokens: Number(row._sum.cache_read_tokens || 0),
      }));
    });
  }

  function formatCostDetail(
    label: string,
    cost: number,
    tokens: number,
    rate: number,
  ): string {
    return `    ${label}: $${cost.toFixed(4)} for ${tokens.toLocaleString()} tokens at $${rate}/MTokens`;
  }

  function calculateModelCacheSavings(
    modelData: {
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_write_tokens: number;
      cache_read_tokens: number;
    },
    model: LlmModelCosts,
  ) {
    const cacheWriteTokens = modelData.cache_write_tokens || 0;
    const cacheReadTokens = modelData.cache_read_tokens || 0;
    const totalCacheTokens = cacheWriteTokens + cacheReadTokens;

    if (totalCacheTokens === 0 || !model.inputCost) {
      return null;
    }

    // Calculate what these cache tokens would have cost at regular input rate
    const cacheSavingsAmount =
      (cacheWriteTokens * (model.inputCost - (model.cacheWriteCost || 0))) /
        1_000_000 +
      (cacheReadTokens * (model.inputCost - (model.cacheReadCost || 0))) /
        1_000_000;

    // Calculate actual cache cost from tokens
    const actualCacheSpend =
      (cacheWriteTokens * (model.cacheWriteCost || 0)) / 1_000_000 +
      (cacheReadTokens * (model.cacheReadCost || 0)) / 1_000_000;

    // Calculate total cost for this model from tokens
    const inputTokens = modelData.input_tokens || 0;
    const outputTokens = modelData.output_tokens || 0;
    const inputCost = (inputTokens * model.inputCost) / 1_000_000;
    const outputCost = (outputTokens * model.outputCost) / 1_000_000;
    const totalCost = inputCost + outputCost + actualCacheSpend;

    const costWithoutCaching = totalCost + cacheSavingsAmount;
    const savingsPercent =
      cacheSavingsAmount > 0
        ? (cacheSavingsAmount / costWithoutCaching) * 100
        : 0;

    return {
      savingsAmount: cacheSavingsAmount,
      costWithoutCaching,
      savingsPercent,
      totalCacheTokens,
      totalCost,
      inputCost,
      outputCost,
      actualCacheSpend,
    };
  }

  async function clearCosts(userId?: number) {
    return usingDatabase(async (prisma) => {
      const where = userId ? { user_id: userId } : {};

      await prisma.costs.deleteMany({ where });
    });
  }

  async function printCosts(userId?: number) {
    const costBreakdown = await getCostBreakdown(userId);
    const modelBreakdowns = await getCostBreakdownWithModels(userId);

    // Use stored total costs
    const totalStoredCost = modelBreakdowns.reduce(
      (sum, model) => sum + (model.total_cost || 0),
      0,
    );

    // Calculate cache savings for display
    let totalCacheSavingsAmount = 0;
    let totalCostWithoutCaching = 0;

    for (const modelData of modelBreakdowns) {
      try {
        const model = llModels.get(modelData.model);

        // Calculate cache savings for display
        const cacheSavings = calculateModelCacheSavings(modelData, model);
        if (cacheSavings) {
          totalCacheSavingsAmount += cacheSavings.savingsAmount;
          totalCostWithoutCaching += cacheSavings.costWithoutCaching;
        } else {
          totalCostWithoutCaching += modelData.total_cost || 0;
        }
      } catch {
        // Use stored cost for unknown models
        totalCostWithoutCaching += modelData.total_cost || 0;
      }
    }

    const spendLimit =
      config.agent.spendLimitDollars || config.spendLimitDollars;
    const userLabel = userId ? `user ${userId}` : "all users";
    output.comment(
      `Total cost for ${userLabel} $${totalStoredCost.toFixed(2)} of $${spendLimit} limit`,
    );

    // Calculate and display cache savings if caching was used
    if (costBreakdown.totalCacheTokens > 0) {
      const savingsPercent =
        totalCostWithoutCaching > 0
          ? (totalCacheSavingsAmount / totalCostWithoutCaching) * 100
          : 0;

      output.comment(
        `Cache savings: $${totalCacheSavingsAmount.toFixed(4)} (${savingsPercent.toFixed(1)}% saved vs $${totalCostWithoutCaching.toFixed(4)} without caching)`,
      );
      output.comment(
        `Cache usage: ${costBreakdown.totalCacheTokens.toLocaleString()} tokens (${costBreakdown.cacheWriteTokens.toLocaleString()} write, ${costBreakdown.cacheReadTokens.toLocaleString()} read)`,
      );
    }

    // Show detailed breakdown by model
    for (const modelData of modelBreakdowns) {
      let model;
      try {
        model = llModels.get(modelData.model);
      } catch {
        output.comment(`Unknown model: ${modelData.model}`);
        continue;
      }

      // Show all models, even with zero usage
      output.comment(
        `  ${model.name}: $${(modelData.total_cost || 0).toFixed(4)} total`,
      );

      // Show token breakdown
      const inputTokens = modelData.input_tokens || 0;
      const outputTokens = modelData.output_tokens || 0;
      const cacheWriteTokens = modelData.cache_write_tokens || 0;
      const cacheReadTokens = modelData.cache_read_tokens || 0;

      if (inputTokens > 0) {
        const inputCost = (inputTokens * model.inputCost) / 1_000_000;
        const inputDetail = formatCostDetail(
          "Input",
          inputCost,
          inputTokens,
          model.inputCost,
        );
        output.comment(inputDetail);
      }

      if (outputTokens > 0) {
        const outputCost = (outputTokens * model.outputCost) / 1_000_000;
        const outputDetail = formatCostDetail(
          "Output",
          outputCost,
          outputTokens,
          model.outputCost,
        );
        output.comment(outputDetail);
      }

      if (model.cacheWriteCost && cacheWriteTokens > 0) {
        const cacheWriteCost =
          (cacheWriteTokens * model.cacheWriteCost) / 1_000_000;
        const cacheWriteDetail = formatCostDetail(
          "Cache write",
          cacheWriteCost,
          cacheWriteTokens,
          model.cacheWriteCost,
        );
        output.comment(cacheWriteDetail);
      }

      if (model.cacheReadCost && cacheReadTokens > 0) {
        const cacheReadCost =
          (cacheReadTokens * model.cacheReadCost) / 1_000_000;
        const cacheReadDetail = formatCostDetail(
          "Cache read",
          cacheReadCost,
          cacheReadTokens,
          model.cacheReadCost,
        );
        output.comment(cacheReadDetail);
      }

      // Show cache savings for this model
      const cacheSavings = calculateModelCacheSavings(modelData, model);
      if (cacheSavings) {
        output.comment(
          `    Cache savings: $${cacheSavings.savingsAmount.toFixed(4)} (${cacheSavings.savingsPercent.toFixed(1)}% saved vs $${cacheSavings.costWithoutCaching.toFixed(4)} without caching)`,
        );
      }
    }

    // Costs by individual users
    if (userId) {
      return; // Skip user breakdown when showing specific user
    }

    await usingDatabase(async (prisma) => {
      const result = await prisma.costs.groupBy({
        by: ["user_id"],
        _sum: {
          cost: true,
        },
      });

      if (result.length <= 1) {
        return;
      }

      // Get usernames for display
      const userIds = result.map((r) => r.user_id);
      const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u.username]));

      for (const row of result) {
        const username = userMap.get(row.user_id) || `user ${row.user_id}`;
        output.comment(
          `  ${username} cost $${Number(row._sum.cost || 0).toFixed(2)}`,
        );
      }
    });
  }

  return {
    recordTokens,
    recordCost,
    calculateCostFromTokens,
    getTotalCosts,
    getCostBreakdown,
    getCostBreakdownWithModels,
    calculateModelCacheSavings,
    clearCosts,
    printCosts,
  };
}

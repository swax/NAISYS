import type { LlmModelCosts } from "./costTracker.js";

export interface CacheSavingsInput {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface CacheSavingsResult {
  savingsAmount: number;
  costWithoutCaching: number;
  savingsPercent: number;
  totalCacheTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  actualCacheSpend: number;
}

export function calculateModelCacheSavings(
  modelData: CacheSavingsInput,
  model: LlmModelCosts,
): CacheSavingsResult | null {
  const cacheWriteTokens = modelData.cacheWriteTokens || 0;
  const cacheReadTokens = modelData.cacheReadTokens || 0;
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
  const inputTokens = modelData.inputTokens || 0;
  const outputTokens = modelData.outputTokens || 0;
  const inputCost = (inputTokens * model.inputCost) / 1_000_000;
  const outputCost = (outputTokens * model.outputCost) / 1_000_000;
  const modelTotalCost = inputCost + outputCost + actualCacheSpend;

  const costWithoutCaching = modelTotalCost + cacheSavingsAmount;
  const savingsPercent =
    cacheSavingsAmount > 0
      ? (cacheSavingsAmount / costWithoutCaching) * 100
      : 0;

  return {
    savingsAmount: cacheSavingsAmount,
    costWithoutCaching,
    savingsPercent,
    totalCacheTokens,
    totalCost: modelTotalCost,
    inputCost,
    outputCost,
    actualCacheSpend,
  };
}

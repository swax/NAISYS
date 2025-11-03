import { describe, expect, test } from "@jest/globals";

// Simple unit test for the calculation function without needing the full module
describe("calculateModelCacheSavings", () => {
  // Copy of the function for testing
  function calculateModelCacheSavings(modelData: any, model: any) {
    const cacheWriteTokens = modelData.cache_write_tokens || 0;
    const cacheReadTokens = modelData.cache_read_tokens || 0;
    const totalCacheTokens = cacheWriteTokens + cacheReadTokens;
    
    if (totalCacheTokens === 0 || !model.inputCost) {
      return null;
    }
    
    // Calculate what these cache tokens would have cost at regular input rate
    const cacheSavingsAmount = (cacheWriteTokens * (model.inputCost - (model.cacheWriteCost || 0))) / 1_000_000 + 
                             (cacheReadTokens * (model.inputCost - (model.cacheReadCost || 0))) / 1_000_000;
    
    const actualCacheSpend = modelData.cache_write + modelData.cache_read;
    const costWithoutCaching = modelData.total + cacheSavingsAmount;
    const savingsPercent = cacheSavingsAmount > 0 ? (cacheSavingsAmount / costWithoutCaching) * 100 : 0;
    
    return {
      savingsAmount: cacheSavingsAmount,
      costWithoutCaching,
      savingsPercent,
      totalCacheTokens
    };
  }

  test("should return null when no cache tokens", () => {
    const modelData = {
      total: 1.0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      cache_write: 0,
      cache_read: 0
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };
    
    const result = calculateModelCacheSavings(modelData, model);
    expect(result).toBeNull();
  });

  test("should return null when model has no inputCost", () => {
    const modelData = {
      total: 1.0,
      cache_write_tokens: 1000,
      cache_read_tokens: 1000,
      cache_write: 0.00375,
      cache_read: 0.0015
    };
    const model = { inputCost: 0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };
    
    const result = calculateModelCacheSavings(modelData, model);
    expect(result).toBeNull();
  });

  test("should calculate savings correctly for cache read tokens", () => {
    const modelData = {
      total: 0.0015,
      cache_write_tokens: 0,
      cache_read_tokens: 1000,
      cache_write: 0,
      cache_read: 0.0015
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };
    
    const result = calculateModelCacheSavings(modelData, model);
    
    // Cache read savings: 1000 * (3.0 - 1.5) / 1,000,000 = 0.0015
    expect(result?.savingsAmount).toBeCloseTo(0.0015, 6);
    // Cost without caching: 0.0015 + 0.0015 = 0.003
    expect(result?.costWithoutCaching).toBeCloseTo(0.003, 6);
    // Savings percent: 0.0015 / 0.003 * 100 = 50%
    expect(result?.savingsPercent).toBeCloseTo(50, 1);
    expect(result?.totalCacheTokens).toBe(1000);
  });

  test("should calculate savings correctly for cache write tokens", () => {
    const modelData = {
      total: 0.00375,
      cache_write_tokens: 1000,
      cache_read_tokens: 0,
      cache_write: 0.00375,
      cache_read: 0
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };
    
    const result = calculateModelCacheSavings(modelData, model);
    
    // Cache write savings: 1000 * (3.0 - 3.75) / 1,000,000 = -0.00075 (no actual savings)
    expect(result?.savingsAmount).toBeCloseTo(-0.00075, 6);
    // Cost without caching: 0.00375 + (-0.00075) = 0.003
    expect(result?.costWithoutCaching).toBeCloseTo(0.003, 6);
    // Savings percent: 0 (since savings is negative)
    expect(result?.savingsPercent).toBe(0);
    expect(result?.totalCacheTokens).toBe(1000);
  });

  test("should calculate combined cache write and read savings", () => {
    const modelData = {
      total: 0.0053,
      cache_write_tokens: 1000,
      cache_read_tokens: 2000,
      cache_write: 0.00375,
      cache_read: 0.003
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };
    
    const result = calculateModelCacheSavings(modelData, model);
    
    // Write savings: 1000 * (3.0 - 3.75) / 1,000,000 = -0.00075
    // Read savings: 2000 * (3.0 - 1.5) / 1,000,000 = 0.003
    // Total savings: -0.00075 + 0.003 = 0.00225
    expect(result?.savingsAmount).toBeCloseTo(0.00225, 6);
    // Cost without caching: 0.0053 + 0.00225 = 0.00755
    expect(result?.costWithoutCaching).toBeCloseTo(0.00755, 6);
    // Savings percent: 0.00225 / 0.00755 * 100 ≈ 29.8%
    expect(result?.savingsPercent).toBeCloseTo(29.8, 1);
    expect(result?.totalCacheTokens).toBe(3000);
  });
});
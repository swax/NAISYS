import * as config from "../config.js";
import { usingDatabase } from "../utils/dbUtils.js";
import * as output from "../utils/output.js";
import { getLLModel } from "./llModels.js";

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

// Record token usage for LLM calls - calculate and store total cost
export async function recordTokens(
  source: string,
  modelKey: string,
  inputTokens: number = 0,
  outputTokens: number = 0,
  cacheWriteTokens: number = 0,
  cacheReadTokens: number = 0,
) {
  // Calculate total cost from tokens - will throw if model not found
  const model = getLLModel(modelKey);
  const tokenUsage: TokenUsage = { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens };
  const totalCost = calculateCostFromTokens(tokenUsage, model);

  await usingDatabase(async (db) => {
    await db.run(
      `INSERT INTO Costs (date, username, subagent, source, model, cost, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.agent.leadAgent || config.agent.username,
        config.agent.leadAgent ? config.agent.username : null,
        source,
        modelKey,
        totalCost,
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
      ],
    );
  });
}

// Record fixed cost for non-token services like image generation
export async function recordCost(
  cost: number,
  source: string,
  modelKey: string,
) {
  await usingDatabase(async (db) => {
    await db.run(
      `INSERT INTO Costs (date, username, subagent, source, model, cost, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.agent.leadAgent || config.agent.username,
        config.agent.leadAgent ? config.agent.username : null,
        source,
        modelKey,
        cost,
        0, // No tokens for fixed cost services
        0,
        0,
        0,
      ],
    );
  });
}

// Common function to calculate cost from token usage
export function calculateCostFromTokens(tokenUsage: TokenUsage, model: LlmModelCosts): number {
  const inputCost = (tokenUsage.inputTokens * model.inputCost) / 1_000_000;
  const outputCost = (tokenUsage.outputTokens * model.outputCost) / 1_000_000;
  const cacheWriteCost = (tokenUsage.cacheWriteTokens * (model.cacheWriteCost || 0)) / 1_000_000;
  const cacheReadCost = (tokenUsage.cacheReadTokens * (model.cacheReadCost || 0)) / 1_000_000;
  
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export async function getTotalCosts() {
  return usingDatabase(async (db) => {
    const result = await db.get(
      `SELECT sum(cost) as total 
        FROM Costs 
        WHERE username = ?`,
      [config.agent.leadAgent || config.agent.username],
    );

    return result.total;
  });
}

export async function getCostBreakdown() {
  return usingDatabase(async (db) => {
    const result = await db.get(
      `SELECT sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_write_tokens) as cache_write_tokens, sum(cache_read_tokens) as cache_read_tokens 
        FROM Costs 
        WHERE username = ?`,
      [config.agent.leadAgent || config.agent.username],
    );

    const totalCacheTokens = (result.cache_write_tokens || 0) + (result.cache_read_tokens || 0);
    const totalInputTokens = (result.input_tokens || 0) + totalCacheTokens;
    
    return {
      inputTokens: result.input_tokens || 0,
      outputTokens: result.output_tokens || 0,
      cacheWriteTokens: result.cache_write_tokens || 0,
      cacheReadTokens: result.cache_read_tokens || 0,
      totalInputTokens,
      totalCacheTokens,
    };
  });
}

export async function getCostBreakdownWithModels() {
  return usingDatabase(async (db) => {
    const result = await db.all(
      `SELECT model, sum(cost) as total_cost, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_write_tokens) as cache_write_tokens, sum(cache_read_tokens) as cache_read_tokens 
        FROM Costs 
        WHERE username = ?
        GROUP BY model
        ORDER BY sum(cost) DESC`,
      [config.agent.leadAgent || config.agent.username],
    );

    return result;
  });
}

function formatCostDetail(label: string, cost: number, tokens: number, rate: number): string {
  return `    ${label}: $${cost.toFixed(4)} for ${tokens.toLocaleString()} tokens at $${rate}/MTokens`;
}

export function calculateModelCacheSavings(
  modelData: { model: string; input_tokens: number; output_tokens: number; cache_write_tokens: number; cache_read_tokens: number },
  model: LlmModelCosts
) {
  const cacheWriteTokens = modelData.cache_write_tokens || 0;
  const cacheReadTokens = modelData.cache_read_tokens || 0;
  const totalCacheTokens = cacheWriteTokens + cacheReadTokens;
  
  if (totalCacheTokens === 0 || !model.inputCost) {
    return null;
  }
  
  // Calculate what these cache tokens would have cost at regular input rate
  const cacheSavingsAmount = (cacheWriteTokens * (model.inputCost - (model.cacheWriteCost || 0))) / 1_000_000 + 
                           (cacheReadTokens * (model.inputCost - (model.cacheReadCost || 0))) / 1_000_000;
  
  // Calculate actual cache cost from tokens
  const actualCacheSpend = (cacheWriteTokens * (model.cacheWriteCost || 0)) / 1_000_000 + 
                          (cacheReadTokens * (model.cacheReadCost || 0)) / 1_000_000;
  
  // Calculate total cost for this model from tokens
  const inputTokens = modelData.input_tokens || 0;
  const outputTokens = modelData.output_tokens || 0;
  const inputCost = (inputTokens * model.inputCost) / 1_000_000;
  const outputCost = (outputTokens * model.outputCost) / 1_000_000;
  const totalCost = inputCost + outputCost + actualCacheSpend;
  
  const costWithoutCaching = totalCost + cacheSavingsAmount;
  const savingsPercent = cacheSavingsAmount > 0 ? (cacheSavingsAmount / costWithoutCaching) * 100 : 0;
  
  return {
    savingsAmount: cacheSavingsAmount,
    costWithoutCaching,
    savingsPercent,
    totalCacheTokens,
    totalCost,
    inputCost,
    outputCost,
    actualCacheSpend
  };
}

export async function printCosts() {
  const costBreakdown = await getCostBreakdown();
  const modelBreakdowns = await getCostBreakdownWithModels();
  
  // Use stored total costs
  const totalStoredCost = modelBreakdowns.reduce((sum, model) => sum + (model.total_cost || 0), 0);
  
  // Calculate cache savings for display
  let totalCacheSavingsAmount = 0;
  let totalCostWithoutCaching = 0;
  
  for (const modelData of modelBreakdowns) {
    try {
      const model = getLLModel(modelData.model);
      
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
  
  output.comment(
    `Total cost so far $${totalStoredCost.toFixed(2)} of $${config.agent.spendLimitDollars} limit`,
  );

  // Calculate and display cache savings if caching was used
  if (costBreakdown.totalCacheTokens > 0) {
    const savingsPercent = totalCostWithoutCaching > 0 ? (totalCacheSavingsAmount / totalCostWithoutCaching) * 100 : 0;
    
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
      model = getLLModel(modelData.model);
    } catch {
      output.comment(`Unknown model: ${modelData.model}`);
      continue;
    }

    // Show all models, even with zero usage
    output.comment(`  ${model.name}: $${(modelData.total_cost || 0).toFixed(4)} total`);
    
    // Show token breakdown
    const inputTokens = modelData.input_tokens || 0;
    const outputTokens = modelData.output_tokens || 0;
    const cacheWriteTokens = modelData.cache_write_tokens || 0;
    const cacheReadTokens = modelData.cache_read_tokens || 0;
    
    if (inputTokens > 0) {
      const inputCost = (inputTokens * model.inputCost) / 1_000_000;
      const inputDetail = formatCostDetail('Input', inputCost, inputTokens, model.inputCost);
      output.comment(inputDetail);
    }
    
    if (outputTokens > 0) {
      const outputCost = (outputTokens * model.outputCost) / 1_000_000;
      const outputDetail = formatCostDetail('Output', outputCost, outputTokens, model.outputCost);
      output.comment(outputDetail);
    }
    
    if (model.cacheWriteCost && cacheWriteTokens > 0) {
      const cacheWriteCost = (cacheWriteTokens * model.cacheWriteCost) / 1_000_000;
      const cacheWriteDetail = formatCostDetail('Cache write', cacheWriteCost, cacheWriteTokens, model.cacheWriteCost);
      output.comment(cacheWriteDetail);
    }
    
    if (model.cacheReadCost && cacheReadTokens > 0) {
      const cacheReadCost = (cacheReadTokens * model.cacheReadCost) / 1_000_000;
      const cacheReadDetail = formatCostDetail('Cache read', cacheReadCost, cacheReadTokens, model.cacheReadCost);
      output.comment(cacheReadDetail);
    }
    
    // Show cache savings for this model
    const cacheSavings = calculateModelCacheSavings(modelData, model);
    if (cacheSavings) {
      output.comment(`    Cache savings: $${cacheSavings.savingsAmount.toFixed(4)} (${cacheSavings.savingsPercent.toFixed(1)}% saved vs $${cacheSavings.costWithoutCaching.toFixed(4)} without caching)`);
    }
  }

  // Costs by subagents
  await usingDatabase(async (db) => {
    const result = await db.all(
      `SELECT subagent, sum(cost) as total_cost
        FROM Costs 
        WHERE username = ? 
        GROUP BY subagent`,
      [config.agent.leadAgent || config.agent.username],
    );

    if (result.length <= 1) {
      return;
    }

    for (const row of result) {
      const label = row.subagent ? `Subagent ${row.subagent}` : "Lead agent";
      output.comment(`  ${label} cost $${(row.total_cost || 0).toFixed(2)}`);
    }
  });
}

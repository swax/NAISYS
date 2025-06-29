import { Database } from "sqlite";
import * as config from "../config.js";
import * as dbUtils from "../utils/dbUtils.js";
import * as output from "../utils/output.js";
import { NaisysPath } from "../utils/pathService.js";
import { getLLModel } from "./llModels.js";

const _dbFilePath = new NaisysPath(`${config.naisysFolder}/lib/costs.db`);

await init();

async function init() {
  const newDbCreated = await dbUtils.initDatabase(_dbFilePath);

  await usingDatabase(async (db) => {
    if (!newDbCreated) {
      return;
    }

    const createTables = [
      `CREATE TABLE Costs (
          id INTEGER PRIMARY KEY,
          date TEXT NOT NULL, 
          username TEXT NOT NULL,
          subagent TEXT,
          source TEXT NOT NULL,
          model TEXT NOT NULL,
          cost REAL NOT NULL,
          input_cost REAL DEFAULT 0,
          output_cost REAL DEFAULT 0,
          cache_write_cost REAL DEFAULT 0,
          cache_read_cost REAL DEFAULT 0,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          cache_write_tokens INTEGER DEFAULT 0,
          cache_read_tokens INTEGER DEFAULT 0
      )`,
    ];

    for (const createTable of createTables) {
      await db.exec(createTable);
    }
  });
}

export async function recordCost(
  cost: number,
  source: string,
  modelName: string,
  inputCost: number = 0,
  outputCost: number = 0,
  cacheWriteCost: number = 0,
  cacheReadCost: number = 0,
  inputTokens: number = 0,
  outputTokens: number = 0,
  cacheWriteTokens: number = 0,
  cacheReadTokens: number = 0,
) {
  await usingDatabase(async (db) => {
    await db.run(
      `INSERT INTO Costs (date, username, subagent, source, model, cost, input_cost, output_cost, cache_write_cost, cache_read_cost, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.agent.leadAgent || config.agent.username,
        config.agent.leadAgent ? config.agent.username : null,
        source,
        modelName,
        cost,
        inputCost,
        outputCost,
        cacheWriteCost,
        cacheReadCost,
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
      ],
    );
  });
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
      `SELECT sum(cost) as total, sum(input_cost) as input, sum(output_cost) as output, sum(cache_write_cost) as cache_write, sum(cache_read_cost) as cache_read, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_write_tokens) as cache_write_tokens, sum(cache_read_tokens) as cache_read_tokens 
        FROM Costs 
        WHERE username = ?`,
      [config.agent.leadAgent || config.agent.username],
    );

    const totalCacheTokens = (result.cache_write_tokens || 0) + (result.cache_read_tokens || 0);
    const totalInputTokens = (result.input_tokens || 0) + totalCacheTokens;
    
    return {
      total: result.total || 0,
      input: result.input || 0,
      output: result.output || 0,
      cacheWrite: result.cache_write || 0,
      cacheRead: result.cache_read || 0,
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
      `SELECT model, sum(cost) as total, sum(input_cost) as input, sum(output_cost) as output, sum(cache_write_cost) as cache_write, sum(cache_read_cost) as cache_read, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_write_tokens) as cache_write_tokens, sum(cache_read_tokens) as cache_read_tokens 
        FROM Costs 
        WHERE username = ?
        GROUP BY model
        ORDER BY total DESC`,
      [config.agent.leadAgent || config.agent.username],
    );

    return result;
  });
}

function formatCostDetail(label: string, cost: number, tokens: number, rate: number): string {
  return `    ${label}: $${cost.toFixed(4)} for ${tokens.toLocaleString()} tokens at $${rate}/MTokens`;
}

export function calculateModelCacheSavings(modelData: any, model: any) {
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

export async function printCosts() {
  const costBreakdown = await getCostBreakdown();
  const modelBreakdowns = await getCostBreakdownWithModels();
  
  output.comment(
    `Total cost so far $${costBreakdown.total.toFixed(2)} of $${config.agent.spendLimitDollars} limit`,
  );

  // Calculate and display cache savings if caching was used
  if (costBreakdown.totalCacheTokens > 0) {
    // Calculate total savings by summing up all model-level savings
    let totalCacheSavingsAmount = 0;
    let totalCostWithoutCaching = 0;
    
    for (const modelData of modelBreakdowns) {
      try {
        const model = getLLModel(modelData.model);
        const cacheSavings = calculateModelCacheSavings(modelData, model);
        if (cacheSavings) {
          totalCacheSavingsAmount += cacheSavings.savingsAmount;
          totalCostWithoutCaching += cacheSavings.costWithoutCaching;
        } else {
          totalCostWithoutCaching += modelData.total;
        }
      } catch {
        totalCostWithoutCaching += modelData.total;
      }
    }
    
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
    output.comment(`  ${model.name}:`);
    
    const inputDetail = formatCostDetail('Input', modelData.input, modelData.input_tokens, model.inputCost);
    output.comment(inputDetail);
    
    const outputDetail = formatCostDetail('Output', modelData.output, modelData.output_tokens, model.outputCost);
    output.comment(outputDetail);
    
    if (model.cacheWriteCost) {
      const cacheWriteDetail = formatCostDetail('Cache write', modelData.cache_write, modelData.cache_write_tokens, model.cacheWriteCost);
      output.comment(cacheWriteDetail);
    }
    
    if (model.cacheReadCost) {
      const cacheReadDetail = formatCostDetail('Cache read', modelData.cache_read, modelData.cache_read_tokens, model.cacheReadCost);
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
      `SELECT subagent, sum(cost) as total 
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
      output.comment(`  ${label} cost $${row.total.toFixed(2)}`);
    }
  });
}

async function usingDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return dbUtils.usingDatabase(_dbFilePath, run);
}

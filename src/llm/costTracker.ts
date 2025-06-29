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
          cache_read_cost REAL DEFAULT 0
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
) {
  await usingDatabase(async (db) => {
    await db.run(
      `INSERT INTO Costs (date, username, subagent, source, model, cost, input_cost, output_cost, cache_write_cost, cache_read_cost) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      `SELECT sum(cost) as total, sum(input_cost) as input, sum(output_cost) as output, sum(cache_write_cost) as cache_write, sum(cache_read_cost) as cache_read 
        FROM Costs 
        WHERE username = ?`,
      [config.agent.leadAgent || config.agent.username],
    );

    return {
      total: result.total || 0,
      input: result.input || 0,
      output: result.output || 0,
      cacheWrite: result.cache_write || 0,
      cacheRead: result.cache_read || 0,
    };
  });
}

export async function getCostBreakdownWithModels() {
  return usingDatabase(async (db) => {
    const result = await db.all(
      `SELECT model, sum(cost) as total, sum(input_cost) as input, sum(output_cost) as output, sum(cache_write_cost) as cache_write, sum(cache_read_cost) as cache_read 
        FROM Costs 
        WHERE username = ?
        GROUP BY model
        ORDER BY total DESC`,
      [config.agent.leadAgent || config.agent.username],
    );

    return result;
  });
}

function formatCostDetail(label: string, cost: number, rate: number): string {
  const tokens = Math.round((cost * 1_000_000) / rate);
  return `    ${label}: $${cost.toFixed(4)} for ${tokens.toLocaleString()} tokens at $${rate}/MTokens`;
}

export async function printCosts() {
  const costBreakdown = await getCostBreakdown();
  const modelBreakdowns = await getCostBreakdownWithModels();
  
  output.comment(
    `Total cost so far $${costBreakdown.total.toFixed(2)} of $${config.agent.spendLimitDollars} limit`,
  );

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
    
    const inputDetail = formatCostDetail('Input', modelData.input, model.inputCost);
    output.comment(inputDetail);
    
    const outputDetail = formatCostDetail('Output', modelData.output, model.outputCost);
    output.comment(outputDetail);
    
    if (model.cacheWriteCost) {
      const cacheWriteDetail = formatCostDetail('Cache write', modelData.cache_write, model.cacheWriteCost);
      output.comment(cacheWriteDetail);
    }
    
    if (model.cacheReadCost) {
      const cacheReadDetail = formatCostDetail('Cache read', modelData.cache_read, model.cacheReadCost);
      output.comment(cacheReadDetail);
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

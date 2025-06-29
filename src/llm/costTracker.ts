import { Database } from "sqlite";
import * as config from "../config.js";
import * as dbUtils from "../utils/dbUtils.js";
import * as output from "../utils/output.js";
import { NaisysPath } from "../utils/pathService.js";

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
          output_cost REAL DEFAULT 0
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
) {
  await usingDatabase(async (db) => {
    await db.run(
      `INSERT INTO Costs (date, username, subagent, source, model, cost, input_cost, output_cost) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.agent.leadAgent || config.agent.username,
        config.agent.leadAgent ? config.agent.username : null,
        source,
        modelName,
        cost,
        inputCost,
        outputCost,
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
      `SELECT sum(cost) as total, sum(input_cost) as input, sum(output_cost) as output 
        FROM Costs 
        WHERE username = ?`,
      [config.agent.leadAgent || config.agent.username],
    );

    return {
      total: result.total || 0,
      input: result.input || 0,
      output: result.output || 0,
    };
  });
}

export async function printCosts() {
  const costBreakdown = await getCostBreakdown();
  output.comment(
    `Total cost so far $${costBreakdown.total.toFixed(2)} of $${config.agent.spendLimitDollars} limit ($${costBreakdown.input.toFixed(2)} input, $${costBreakdown.output.toFixed(2)} output)`,
  );

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

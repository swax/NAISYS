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
          cost REAL NOT NULL
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
) {
  await usingDatabase(async (db) => {
    await db.run(
      `INSERT INTO Costs (date, username, subagent, source, model, cost) VALUES (datetime('now'), ?, ?, ?, ?, ?)`,
      [
        config.agent.leadAgent || config.agent.username,
        config.agent.leadAgent ? config.agent.username : null,
        source,
        modelName,
        cost,
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

export async function printCosts() {
  const totalCost = await getTotalCosts();
  output.comment(
    `Total cost so far $${totalCost.toFixed(2)} of $${config.agent.spendLimitDollars} limit`,
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

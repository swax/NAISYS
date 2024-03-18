import { Database } from "sqlite";
import * as config from "../config.js";
import * as dbUtils from "../utils/dbUtils.js";
import { unixToHostPath } from "../utils/utilities.js";

const _dbFilePath = unixToHostPath(`${config.naisysFolder}/lib/costs.db`);

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
      `INSERT INTO Costs (date, username, source, model, cost) VALUES (datetime('now'), ?, ?, ?, ?)`,
      [config.agent.username, source, modelName, cost],
    );
  });
}

export async function getTotalCosts() {
  return usingDatabase(async (db) => {
    const result = await db.get(
      `SELECT sum(cost) as total 
        FROM Costs 
        WHERE username = ?`,
      [config.agent.username],
    );

    return result.total;
  });
}

async function usingDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return dbUtils.usingDatabase(_dbFilePath, run);
}

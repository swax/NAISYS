import { Database } from "sqlite";
import * as config from "../config.js";
import * as dbUtils from "../utils/dbUtils.js";
import * as output from "../utils/output.js";
import { naisysToHostPath } from "../utils/utilities.js";
import * as contextManager from "./contextManager.js";
import { LlmRole } from "./llmDtos.js";
import * as llmService from "./llmService.js";

const _dbFilePath = naisysToHostPath(`${config.naisysFolder}/lib/dream.db`);

await init();

async function init() {
  const newDbCreated = await dbUtils.initDatabase(_dbFilePath);

  await usingDatabase(async (db) => {
    if (!newDbCreated) {
      return;
    }

    await db.exec(`CREATE TABLE DreamLog (
      id INTEGER PRIMARY KEY, 
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      dream TEXT NOT NULL
    )`);
  });
}

export async function goodmorning(): Promise<string> {
  return await usingDatabase(async (db) => {
    const row = await db.get(
      `SELECT dream 
       FROM DreamLog 
       WHERE username = ? 
       ORDER BY date DESC LIMIT 1`,
      config.agent.username,
    );

    return row?.dream;
  });
}

export async function goodnight(): Promise<string> {
  output.comment("Dreaming about the session...");

  const dream = await runDreamSequence();

  await storeDream(dream);

  return dream;
}

async function runDreamSequence(): Promise<string> {
  const systemMessage = `You are ${config.agent.username}'s unconcious sleep process. You compile all ${config.agent.username}'s
thoughts during the day and reduce them down to important things to remember - references, plans, project structure, schemas, 
file locations, urls, and more. You are the sleep process, and you are the most important process. Using your results, 
when ${config.agent.username} wakes up they'll know exactly what to do and how to do it.`;

  const allTheThings = contextManager.messages.map((m) => m.content).join("\n");

  return await llmService.query(
    config.agent.dreamModel,
    systemMessage,
    [
      {
        role: LlmRole.User,
        content: allTheThings,
      },
      {
        role: LlmRole.Assistant,
        content: "We sure had an eventful day",
      },
      {
        role: LlmRole.User,
        content: `Dream on all these things and let me know what you come up with. Use what was done in the previous session as a guide 
          for what's possible tomorrow. Don't overload yourself with too many thoughts and ideas. Keep important references for the future
          but don't go into any great detail of future plans unless it's happening soon. `,
      },
    ],
    "dream",
  );
}

async function usingDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return dbUtils.usingDatabase(_dbFilePath, run);
}

async function storeDream(dream: string) {
  await usingDatabase(async (db) => {
    await db.run(
      `INSERT INTO DreamLog (username, date, dream) 
       VALUES (?, datetime('now'), ?)`,
      config.agent.username,
      dream,
    );
  });
}

import { Database } from "sqlite";
import * as config from "../config.js";
import * as dbUtils from "../utils/dbUtils.js";
import * as output from "../utils/output.js";
import { NaisysPath } from "../utils/pathService.js";
import * as contextManager from "./contextManager.js";
import { ContentSource, LlmRole } from "./llmDtos.js";
import * as llmService from "./llmService.js";

const _dbFilePath = new NaisysPath(`${config.naisysFolder}/lib/dream.db`);

let _lastDream = "";

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
  if (!config.agent.persistAcrossRuns) {
    return _lastDream;
  }

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
  output.comment("Wrapping up the session...");

  const dream = await runDreamSequence();

  if (config.agent.persistAcrossRuns) {
    await storeDream(dream);
  } else {
    _lastDream = dream;
  }

  return dream;
}

async function runDreamSequence(): Promise<string> {
  const systemMessage = `${config.agent.agentPrompt}

Below is the console log from this session. Please process this log and 
reduce it down to important things to remember - references, plans, project structure, schemas, 
file locations, urls, and more. You don't need to summarize what happened, or plan what to do in the far future, just focus on the
near term. Check the console log for inconsistencies, things to fix and/or check. Using this information the
next session should be able to start with minimal scanning of existing files to figure out what to do 
and how to do it.`;

  const combinedContextLog = contextManager
    .getCombinedMessages()
    .map((m) => {
      const suffix = m.source == ContentSource.ConsolePrompt ? "" : "\n";
      return m.content + suffix;
    })
    .join("");

  return await llmService.query(
    config.agent.dreamModel,
    systemMessage,
    [
      {
        role: LlmRole.User,
        content: combinedContextLog,
      },
      {
        role: LlmRole.Assistant,
        content:
          "Console log processed so that the next session can start with minimal scanning of existing files.",
      },
      {
        role: LlmRole.User,
        content: `Please show the results of the processing.`,
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

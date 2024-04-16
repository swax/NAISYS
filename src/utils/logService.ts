import escapeHtml from "escape-html";
import * as fs from "fs";
import { Database } from "sqlite";
import * as config from "../config.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import * as dbUtils from "./dbUtils.js";
import * as pathService from "./pathService.js";
import { NaisysPath } from "./pathService.js";

const _dbFilePath = new NaisysPath(`${config.naisysFolder}/lib/log.db`);

const _combinedLogFilePath = new NaisysPath(
  `${config.websiteFolder || config.naisysFolder}/logs/combined-log.html`,
);

const _userLogFilePath = new NaisysPath(
  `${config.websiteFolder || config.naisysFolder}/logs/${config.agent.username}-log.html`,
);

await init();

async function init() {
  initLogFile(_combinedLogFilePath);
  initLogFile(_userLogFilePath);

  // Init log database
  const newDbCreated = await dbUtils.initDatabase(_dbFilePath);

  await usingDatabase(async (db) => {
    if (!newDbCreated) {
      return;
    }

    const createTables = [
      `CREATE TABLE ContextLog (
          id INTEGER PRIMARY KEY, 
          username TEXT NOT NULL,
          source TEXT NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          date TEXT NOT NULL
      )`,
    ];

    for (const createTable of createTables) {
      await db.exec(createTable);
    }
  });
}

function initLogFile(filePath: NaisysPath) {
  pathService.ensureFileDirExists(filePath);

  if (fs.existsSync(filePath.toHostPath())) {
    return;
  }

  // Start html file with table: date, user, role, messages
  fs.writeFileSync(
    filePath.toHostPath(),
    `<html>
        <head><title>Context Log</title></head>
        <style>
          body { font-family: monospace; background-color: black; color: white; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid grey; padding: 8px; }
          th { text-align: left; }
          td { vertical-align: top; }
          .date { white-space: nowrap; }
          .llm { color: magenta; }
          .error { color: red; }
          .comment { color: green; }
        </style>
        <body>
          <table border="1">
            <tr><th>Date</th><th>User</th><th>Source</th><th>Message</th></tr>`,
  );
}

export async function write(message: LlmMessage) {
  const insertedId = await usingDatabase(async (db) => {
    const inserted = await db.run(
      "INSERT INTO ContextLog (username, source, type, message, date) VALUES (?, ?, ?, ?, ?)",
      config.agent.username,
      roleToSource(message.role),
      message.type || "",
      message.content,
      new Date().toISOString(),
    );

    return inserted.lastID;
  });

  appendToLogFile(_combinedLogFilePath, message);
  appendToLogFile(_userLogFilePath, message);

  return insertedId;
}

function appendToLogFile(filepath: NaisysPath, message: LlmMessage) {
  const source = roleToSource(message.role);

  fs.appendFileSync(
    filepath.toHostPath(),
    `<tr>
      <td class='date'>${new Date().toLocaleString()}</td>
      <td>${config.agent.username}</td>
      <td>${source}</td>
      <td class='${source.toLocaleLowerCase()} ${message.type}'>
        <pre>${escapeHtml(message.content)}</pre>
      </td>
    </tr>`,
  );
}

async function usingDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return dbUtils.usingDatabase(_dbFilePath, run);
}

export function roleToSource(role: LlmRole) {
  switch (role) {
    case LlmRole.Assistant:
      return "LLM";
    case LlmRole.User:
      return "NAISYS";
    case LlmRole.System:
      return "NAISYS";
  }
}
/** Write entire context to a file in the users home directory */
export function recordContext(contextLog: string) {
  const filePath = new NaisysPath(
    `${config.naisysFolder}/agent-data/${config.agent.username}/current-context.txt`,
  );

  pathService.ensureFileDirExists(filePath);

  fs.writeFileSync(filePath.toHostPath(), contextLog);
}

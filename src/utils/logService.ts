import escapeHtml from "escape-html";
import * as fs from "fs";
import { Database } from "sqlite";
import * as config from "../config.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import * as dbUtils from "./dbUtils.js";
import { ensureFileDirExists, unixToHostPath } from "./utilities.js";

const _dbFilePath = unixToHostPath(`${config.naisysFolder}/lib/log.db`);

const _combinedLogFilePath = unixToHostPath(
  `${config.websiteFolder || config.naisysFolder}/logs/combined-log.html`,
);

const _userLogFilePath = unixToHostPath(
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

function initLogFile(filePath: string) {
  ensureFileDirExists(filePath);

  if (fs.existsSync(filePath)) {
    return;
  }

  // Start html file with table: date, user, role, messages
  fs.writeFileSync(
    filePath,
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

export async function update(message: LlmMessage, appendedText: string) {
  await usingDatabase(async (db) => {
    await db.run(
      "UPDATE ContextLog SET message = ? WHERE id = ?",
      message.content,
      message.logId,
    );
  });

  // Can't rewrite the log like we can the db, so just log the appended text
  const appendedMessage = {
    role: message.role,
    content: appendedText,
  };

  appendToLogFile(_combinedLogFilePath, appendedMessage);
  appendToLogFile(_userLogFilePath, appendedMessage);
}

function appendToLogFile(filepath: string, message: LlmMessage) {
  const source = roleToSource(message.role);

  fs.appendFileSync(
    filepath,
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

function roleToSource(role: LlmRole) {
  switch (role) {
    case LlmRole.Assistant:
      return "LLM";
    case LlmRole.User:
      return "NAISYS";
    case LlmRole.System:
      return "NAISYS";
  }
}

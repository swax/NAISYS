import escapeHtml from "escape-html";
import * as fs from "fs";
import { Database } from "sqlite";
import * as config from "./config.js";
import * as dbUtils from "./dbUtils.js";
import { ensureFileDirExists, naisysToHostPath } from "./utilities.js";

export enum LlmRole {
  Assistant = "assistant",
  User = "user",
  /** Not supported by Google API */
  System = "system",
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  logId?: number;
}

const _dbFilePath = naisysToHostPath(`${config.rootFolder}/var/naisys/log.db`);

const _combinedLogFilePath = naisysToHostPath(
  `${config.rootFolder}/var/www/logs/combined-log.html`,
);

const _userLogFilePath = naisysToHostPath(
  `${config.rootFolder}/var/www/logs/${config.agent.username}-log.html`,
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
          role TEXT NOT NULL,
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
          .assistant { color: magenta; }
        </style>
        <body>
          <table border="1">
            <tr><th>Date</th><th>User</th><th>Role</th><th>Message</th></tr>`,
  );
}

export async function add(message: LlmMessage) {
  await usingDatabase(async (db) => {
    const inserted = await db.run(
      "INSERT INTO ContextLog (role, message, date) VALUES (?, ?, ?)",
      roleToString(message.role),
      message.content,
      new Date().toISOString(),
    );

    message.logId = inserted.lastID;
  });

  appendToLogFile(_combinedLogFilePath, message);
  appendToLogFile(_userLogFilePath, message);
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
  fs.appendFileSync(
    filepath,
    `<tr>
      <td>${new Date().toISOString()}</td>
      <td>${config.agent.username}</td>
      <td>${roleToString(message.role)}</td>
      <td class='${message.role}'>
        <pre>${escapeHtml(message.content)}</pre>
      </td>
    </tr>`,
  );
}

async function usingDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return dbUtils.usingDatabase(_dbFilePath, run);
}

function roleToString(role: LlmRole) {
  switch (role) {
    case LlmRole.Assistant:
      return "LLM";
    case LlmRole.User:
      return "NAISYS";
    case LlmRole.System:
      return "NAISYS";
  }
}

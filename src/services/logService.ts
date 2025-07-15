import escapeHtml from "escape-html";
import * as fs from "fs";
import * as config from "../config.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { usingDatabase } from "./dbService.js";
import * as pathService from "./pathService.js";
import { NaisysPath } from "./pathService.js";

const _combinedLogFilePath = new NaisysPath(
  `${config.websiteFolder || config.naisysFolder}/logs/combined-log.html`,
);

const _userLogFilePath = new NaisysPath(
  `${config.websiteFolder || config.naisysFolder}/logs/${config.agent.username}-log.html`,
);

init();

function init() {
  initLogFile(_combinedLogFilePath);
  initLogFile(_userLogFilePath);
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
      "INSERT INTO ContextLog (username, role, source, type, message, date) VALUES (?, ?, ?, ?, ?, ?)",
      config.agent.username,
      toSimpleRole(message.role),
      message.source?.toString() || "",
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
  const source = toSimpleRole(message.role);

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

export function toSimpleRole(role: LlmRole) {
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

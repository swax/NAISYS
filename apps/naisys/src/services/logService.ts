import escapeHtml from "escape-html";
import * as fs from "fs";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { createDatabaseService } from "./dbService.js";
import * as pathService from "./pathService.js";
import { NaisysPath } from "./pathService.js";
import { createConfig } from "../config.js";

export function createLogService(
  config: Awaited<ReturnType<typeof createConfig>>,
  { usingDatabase }: Awaited<ReturnType<typeof createDatabaseService>>,
) {
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

  async function write(message: LlmMessage) {
    const insertedId = await usingDatabase(async (prisma) => {
      const inserted = await prisma.contextLog.create({
        data: {
          username: config.agent.username,
          role: toSimpleRole(message.role),
          source: message.source?.toString() || "",
          type: message.type || "",
          message: message.content,
          date: new Date().toISOString(),
        },
      });

      return inserted.id;
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

  function toSimpleRole(role: LlmRole) {
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
  function recordContext(contextLog: string) {
    const filePath = new NaisysPath(
      `${config.naisysFolder}/agent-data/${config.agent.username}/current-context.txt`,
    );

    pathService.ensureFileDirExists(filePath);

    fs.writeFileSync(filePath.toHostPath(), contextLog);
  }
  return {
    write,
    toSimpleRole,
    recordContext,
  };
}

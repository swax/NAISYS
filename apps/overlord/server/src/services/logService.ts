import { LogRole, LogSource, LogType } from "shared";
import { LogEntry } from "shared/src/log-types.js";
import { selectFromNaisysDb } from "../database/naisysDatabase.js";
import { updateLatestLogIds } from "./readService.js";

interface NaisysLogEntry {
  id: number;
  username: string;
  role: LogRole;
  source: LogSource;
  type: LogType;
  message: string;
  date: string;
}

export async function getLogs(
  after?: number,
  limit: number = 1000,
): Promise<LogEntry[]> {
  try {
    let sql = `
      SELECT id, username, role, source, type, message, date
      FROM ContextLog
    `;
    const params: any[] = [];

    const conditions: string[] = [];

    if (after !== undefined && after > 0) {
      conditions.push("id > ?");
      params.push(after);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);

    const dbLogs = await selectFromNaisysDb<NaisysLogEntry[]>(sql, params);

    // Resort ascending
    dbLogs.sort((a, b) => a.id - b.id);

    const logs = dbLogs.map((log) => ({
      id: log.id,
      username: log.username,
      role: log.role,
      source: log.source,
      type: log.type,
      message: log.message,
      date: log.date,
    }));

    // Used for tracking unread logs
    await updateLatestLogIds(logs);

    return logs;
  } catch (error) {
    console.error("Error fetching logs from Naisys database:", error);
    return [];
  }
}

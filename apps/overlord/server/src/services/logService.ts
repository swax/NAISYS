import { LogEntry, LogRole, LogSource, LogType } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { updateLatestLogIds } from "./readService.js";

export async function getLogs(
  after?: number,
  limit: number = 1000,
): Promise<LogEntry[]> {
  try {
    const dbLogs = await usingNaisysDb(async (prisma) => {
      return await prisma.context_log.findMany({
        where: after !== undefined && after > 0 ? { id: { gt: after } } : undefined,
        orderBy: { id: 'desc' },
        take: limit,
        select: {
          id: true,
          username: true,
          role: true,
          source: true,
          type: true,
          message: true,
          date: true,
        },
      });
    });

    // Resort ascending
    dbLogs.sort((a, b) => a.id - b.id);

    const logs = dbLogs.map((log) => ({
      id: log.id,
      username: log.username,
      role: log.role as LogRole,
      source: log.source as LogSource,
      type: log.type as LogType,
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

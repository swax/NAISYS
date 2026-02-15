import {
  LogEntry,
  LogRole,
  LogSource,
  LogType,
  RunSession,
} from "@naisys-supervisor/shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { getLogger } from "../logger.js";
import { cachedForSeconds } from "../utils/cache.js";

export interface RunsData {
  runs: RunSession[];
  timestamp: string;
  total?: number;
}

export interface ContextLogData {
  logs: LogEntry[];
  timestamp: string;
}

export const getRunsData = cachedForSeconds(
  0.25,
  async (
    userId: number,
    updatedSince?: string,
    page: number = 1,
    count: number = 50,
  ): Promise<RunsData> => {
    try {
      const result = await usingNaisysDb(async (prisma) => {
        // Build the where clause
        const where: any = {
          user_id: userId,
        };

        // If updatedSince is provided, only fetch runs that were updated after that time
        if (updatedSince) {
          where.last_active = {
            gt: updatedSince,
          };
        }

        // Only get total count on initial fetch (when updatedSince is not set)
        const total = updatedSince
          ? undefined
          : await prisma.run_session.count({ where });

        // Get paginated runs
        const runSessions = await prisma.run_session.findMany({
          where,
          orderBy: {
            last_active: "desc",
          },
          skip: (page - 1) * count,
          take: count,
        });

        return { runSessions, total };
      });

      // Map database records to our API format
      const runs: RunSession[] = result.runSessions.map((session) => {
        return {
          userId: session.user_id,
          runId: session.run_id,
          sessionId: session.session_id,
          createdAt: session.created_at.toISOString(),
          lastActive: session.last_active.toISOString(),
          modelName: session.model_name,
          latestLogId: session.latest_log_id,
          totalLines: session.total_lines,
          totalCost: session.total_cost,
        };
      });

      return {
        runs,
        timestamp: new Date().toISOString(),
        total: result.total,
      };
    } catch (error) {
      getLogger().error(error, "Error fetching runs data");

      // Return empty data on error
      return {
        runs: [],
        timestamp: new Date().toISOString(),
      };
    }
  },
);

export const getContextLog = cachedForSeconds(
  0.25,
  async (
    userId: number,
    runId: number,
    sessionId: number,
    logsAfter?: number,
  ): Promise<ContextLogData> => {
    try {
      const dbLogs = await usingNaisysDb(async (prisma) => {
        const where: any = {
          user_id: userId,
          run_id: runId,
          session_id: sessionId,
        };

        // If logsAfter is provided, only fetch logs after that ID
        if (logsAfter !== undefined) {
          where.id = { gt: logsAfter };
        }

        return await prisma.context_log.findMany({
          where,
          orderBy: { id: "desc" },
          select: {
            id: true,
            role: true,
            source: true,
            type: true,
            message: true,
            created_at: true,
            users: {
              select: {
                username: true,
              },
            },
          },
        });
      });

      const logs: LogEntry[] = dbLogs.map((log) => ({
        id: log.id,
        username: log.users.username,
        role: log.role as LogRole,
        source: log.source as LogSource,
        type: log.type as LogType,
        message: log.message,
        createdAt: log.created_at.toISOString(),
      }));

      return {
        logs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      getLogger().error(error, "Error fetching context log");

      // Return empty data on error
      return {
        logs: [],
        timestamp: new Date().toISOString(),
      };
    }
  },
);

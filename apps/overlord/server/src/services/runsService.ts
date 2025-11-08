import { LogEntry, LogRole, LogSource, LogType, RunSession } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { isAgentOnline } from "../utils/agentUtils.js";

export interface RunsData {
  runs: RunSession[];
  timestamp: string;
}

export interface ContextLogData {
  logs: LogEntry[];
  timestamp: string;
}

export async function getRunsData(
  userId: number,
  updatedSince?: string,
): Promise<RunsData> {
  try {
    const runSessions = await usingNaisysDb(async (prisma) => {
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

      return await prisma.run_session.findMany({
        where,
        orderBy: {
          last_active: "desc",
        },
      });
    });

    // Map database records to our API format
    const runs: RunSession[] = runSessions.map((session) => ({
      userId: session.user_id,
      runId: session.run_id,
      sessionId: session.session_id,
      startDate: session.start_date,
      lastActive: session.last_active,
      modelName: session.model_name,
      totalLines: session.total_lines,
      totalCost: session.total_cost,
      isOnline: isAgentOnline(session.last_active),
    }));

    return {
      runs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching runs data:", error);

    // Return empty data on error
    return {
      runs: [],
      timestamp: new Date().toISOString(),
    };
  }
}

export async function getContextLog(
  userId: number,
  runId: number,
  sessionId: number,
  logsAfter?: number,
): Promise<ContextLogData> {
  try {
    const dbLogs = await usingNaisysDb(async (prisma) => {
      const where: any = {
        user_id: userId,
        run_id: runId,
        session_id: sessionId,
      };

      // If logsAfter is provided, only fetch logs after that ID
      if (logsAfter !== undefined && logsAfter > 0) {
        where.id = { gt: logsAfter };
      }

      return await prisma.context_log.findMany({
        where,
        orderBy: { id: "asc" },
        select: {
          id: true,
          role: true,
          source: true,
          type: true,
          message: true,
          date: true,
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
      date: log.date,
    }));

    return {
      logs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching context log:", error);

    // Return empty data on error
    return {
      logs: [],
      timestamp: new Date().toISOString(),
    };
  }
}

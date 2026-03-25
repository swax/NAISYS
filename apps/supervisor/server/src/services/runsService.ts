import { LogEntry, RunSession } from "@naisys-supervisor/shared";

import { hubDb } from "../database/hubDb.js";

export interface RunsData {
  runs: RunSession[];
  timestamp: string;
  total?: number;
}

export interface ContextLogData {
  logs: LogEntry[];
  timestamp: string;
}

export async function getRunsData(
  userId: number,
  updatedSince?: string,
  page: number = 1,
  count: number = 50,
): Promise<RunsData> {
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
    : await hubDb.run_session.count({ where });

  // Get paginated runs
  const runSessions = await hubDb.run_session.findMany({
    where,
    orderBy: {
      last_active: "desc",
    },
    skip: (page - 1) * count,
    take: count,
  });

  // Map database records to our API format
  const runs: RunSession[] = runSessions.map((session) => {
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
    total,
  };
}

export async function getContextLog(
  userId: number,
  runId: number,
  sessionId: number,
  logsAfter?: number,
  logsBefore?: number,
): Promise<ContextLogData> {
  const where: any = {
    user_id: userId,
    run_id: runId,
    session_id: sessionId,
  };

  // Build ID range filter for incremental fetches / gap recovery
  if (logsAfter !== undefined || logsBefore !== undefined) {
    where.id = {};
    if (logsAfter !== undefined) where.id.gt = logsAfter;
    if (logsBefore !== undefined) where.id.lt = logsBefore;
  }

  const dbLogs = await hubDb.context_log.findMany({
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
      attachment: {
        select: {
          id: true,
          filename: true,
          file_size: true,
        },
      },
    },
  });

  const logs: LogEntry[] = dbLogs.map((log) => ({
    id: log.id,
    username: log.users.username,
    role: log.role,
    source: log.source,
    type: log.type,
    message: log.message,
    createdAt: log.created_at.toISOString(),
    ...(log.attachment && {
      attachment: {
        id: log.attachment.id,
        filename: log.attachment.filename,
        fileSize: log.attachment.file_size,
      },
    }),
  }));

  return {
    logs,
    timestamp: new Date().toISOString(),
  };
}

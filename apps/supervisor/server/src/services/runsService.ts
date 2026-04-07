import { ATTACHMENT_NO_ACCESS } from "@naisys/common";
import type { LogPushEntry } from "@naisys/hub-protocol";
import type { LogEntry, RunSession } from "@naisys/supervisor-shared";

import { hubDb } from "../database/hubDb.js";
import { attachmentUrl } from "../hateoas.js";

export interface RunsData {
  runs: RunSession[];
  timestamp: string;
  total?: number;
}

export interface ContextLogData {
  logs: LogEntry[];
  timestamp: string;
}

const VOWELS = "aeiou";
const CONSONANTS = "bcdfghjklmnpqrstvwxyz";
const DIGITS = "0123456789";

function randomChar(pool: string): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Replace each letter/digit with a random one of the same class (vowel/consonant/digit), preserving case and all other characters. */
function obfuscateText(text: string): string {
  let result = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (DIGITS.includes(lower)) {
      result += randomChar(DIGITS);
    } else if (VOWELS.includes(lower)) {
      const r = randomChar(VOWELS);
      result += ch === lower ? r : r.toUpperCase();
    } else if (CONSONANTS.includes(lower)) {
      const r = randomChar(CONSONANTS);
      result += ch === lower ? r : r.toUpperCase();
    } else {
      result += ch;
    }
  }
  return result;
}

function obfuscateFilename(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return "attachment";
  return `attachment${filename.slice(dotIndex)}`;
}

/** Obfuscate all log message text for public preview. */
export function obfuscateLogs(data: ContextLogData): ContextLogData {
  return {
    ...data,
    logs: data.logs.map((log) => ({
      ...log,
      message: obfuscateText(log.message),
      attachment: log.attachment
        ? {
            id: ATTACHMENT_NO_ACCESS,
            filename: obfuscateFilename(log.attachment.filename),
            fileSize: 0,
            downloadUrl: "",
          }
        : undefined,
    })),
  };
}

/** Obfuscate log push entries for WebSocket broadcast to unprivileged clients. */
export function obfuscatePushEntries(entries: LogPushEntry[]): LogPushEntry[] {
  return entries.map((entry) => ({
    ...entry,
    message: obfuscateText(entry.message),
    attachmentId: entry.attachmentId ? ATTACHMENT_NO_ACCESS : undefined,
    attachmentFilename: entry.attachmentFilename
      ? obfuscateFilename(entry.attachmentFilename)
      : undefined,
    attachmentFileSize: entry.attachmentId ? 0 : undefined,
  }));
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
          public_id: true,
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
        id: log.attachment.public_id,
        filename: log.attachment.filename,
        fileSize: log.attachment.file_size,
        downloadUrl: attachmentUrl(log.attachment.public_id, log.attachment.filename),
      },
    }),
  }));

  return {
    logs,
    timestamp: new Date().toISOString(),
  };
}

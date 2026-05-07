import { ATTACHMENT_NO_ACCESS } from "@naisys/common";
import type { LogPushEntry } from "@naisys/hub-protocol";
import type {
  AgentRunLogEntry,
  HostEnvironment,
  LogEntry,
  LogSource,
  RunSession,
} from "@naisys/supervisor-shared";
import {
  AGENT_RUN_LOG_ENTRIES_DEFAULT_LIMIT,
  HostEnvironmentSchema,
} from "@naisys/supervisor-shared";

import { hubDb } from "../database/hubDb.js";
import { attachmentUrl } from "../hateoas.js";
import { timestampCursorWhere } from "../paging.js";

function parseHostEnvironment(raw: string | null): HostEnvironment | null {
  if (!raw) return null;
  try {
    const parsed = HostEnvironmentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface RunsData {
  runs: RunSession[];
  timestamp: string;
  total?: number;
}

export interface ContextLogData {
  logs: LogEntry[];
  timestamp: string;
}

export interface AgentRunLogEntriesData {
  entries: AgentRunLogEntry[];
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

/** Obfuscate the message field on each entry for users without view_run_logs. */
export function obfuscateAgentRunLogEntries(
  data: AgentRunLogEntriesData,
): AgentRunLogEntriesData {
  return {
    ...data,
    entries: data.entries.map((e) => ({
      ...e,
      message: obfuscateText(e.message),
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

export interface RunsFilter {
  userId?: number;
  hostName?: string;
}

export async function getRunsData(
  filter: RunsFilter,
  updatedSince?: string,
  updatedBefore?: string,
  page: number = 1,
  count: number = 50,
): Promise<RunsData> {
  const where: any = {};
  if (filter.userId !== undefined) {
    where.user_id = filter.userId;
  }
  if (filter.hostName !== undefined) {
    where.host = { name: filter.hostName };
  }

  const cursorWhere = timestampCursorWhere(updatedSince, updatedBefore, "gt");
  if (cursorWhere) where.last_active = cursorWhere;

  // Only get total count on initial fetch (no cursor filters)
  const total =
    updatedSince || updatedBefore
      ? undefined
      : await hubDb.run_session.count({ where });

  // Get paginated runs
  const runSessions = await hubDb.run_session.findMany({
    where,
    // Group sessions and subagents under their parent run. subagent_id desc
    // puts the parent (0) before subagents (-1, -2, ...).
    orderBy: [
      { run_id: "desc" },
      { subagent_id: "desc" },
      { created_at: "desc" },
    ],
    skip: (page - 1) * count,
    take: count,
    include: {
      host: { select: { name: true, environment: true } },
      users: { select: { username: true } },
    },
  });

  // Map database records to our API format
  const runs: RunSession[] = runSessions.map((session) => {
    return {
      userId: session.user_id,
      username: session.users.username,
      runId: session.run_id,
      subagentId: session.subagent_id === 0 ? undefined : session.subagent_id,
      sessionId: session.session_id,
      createdAt: session.created_at.toISOString(),
      lastActive: session.last_active.toISOString(),
      modelName: session.model_name,
      latestLogId: session.latest_log_id,
      totalLines: session.total_lines,
      totalCost: session.total_cost,
      hostName: session.host?.name ?? null,
      hostEnvironment: parseHostEnvironment(session.host?.environment ?? null),
    };
  });

  return {
    runs,
    timestamp: new Date().toISOString(),
    total,
  };
}

/**
 * Fetch RunSession rows for runs that participated in a chat thread, derived
 * from `mail_recipients.read_run_id` (set on send for the sender's `from` row,
 * and on read for each recipient's `to` row). Runs that never touched this
 * thread — admin, mail, config, fire-and-forget tasks — are filtered out.
 */
export async function getChatThreadRuns(
  participants: string,
): Promise<RunsData> {
  const pairs = await hubDb.mail_recipients.findMany({
    where: {
      read_run_id: { not: null },
      message: {
        kind: "chat",
        participants,
      },
    },
    distinct: ["user_id", "read_run_id"],
    select: {
      user_id: true,
      read_run_id: true,
    },
  });

  if (pairs.length === 0) {
    return { runs: [], timestamp: new Date().toISOString() };
  }

  // Pull every (session, subagent) row under each (userId, runId) — a single
  // chat-relevant run can span multiple sessions or have subagents.
  const runSessions = await hubDb.run_session.findMany({
    where: {
      OR: pairs.map((p) => ({
        user_id: p.user_id,
        run_id: p.read_run_id as number,
      })),
    },
    orderBy: [
      { run_id: "desc" },
      { subagent_id: "desc" },
      { created_at: "desc" },
    ],
    include: {
      host: { select: { name: true, environment: true } },
      users: { select: { username: true } },
    },
  });

  const runs: RunSession[] = runSessions.map((session) => ({
    userId: session.user_id,
    username: session.users.username,
    runId: session.run_id,
    subagentId: session.subagent_id === 0 ? undefined : session.subagent_id,
    sessionId: session.session_id,
    createdAt: session.created_at.toISOString(),
    lastActive: session.last_active.toISOString(),
    modelName: session.model_name,
    latestLogId: session.latest_log_id,
    totalLines: session.total_lines,
    totalCost: session.total_cost,
    hostName: session.host?.name ?? null,
    hostEnvironment: parseHostEnvironment(session.host?.environment ?? null),
  }));

  return {
    runs,
    timestamp: new Date().toISOString(),
  };
}

export async function getContextLog(
  userId: number,
  runId: number,
  sessionId: number,
  logsAfter?: number,
  logsBefore?: number,
  limit?: number,
  subagentId?: number,
  sources?: LogSource[],
): Promise<ContextLogData> {
  const where: any = {
    user_id: userId,
    run_id: runId,
    subagent_id: subagentId ?? 0,
    session_id: sessionId,
  };

  // Build ID range filter for incremental fetches / gap recovery
  if (logsAfter !== undefined || logsBefore !== undefined) {
    where.id = {};
    if (logsAfter !== undefined) where.id.gt = logsAfter;
    if (logsBefore !== undefined) where.id.lt = logsBefore;
  }

  if (sources && sources.length > 0) {
    where.source = { in: sources };
  }

  const dbLogs = await hubDb.context_log.findMany({
    where,
    orderBy: { id: "desc" },
    ...(limit !== undefined && { take: limit }),
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
        downloadUrl: attachmentUrl(
          log.attachment.public_id,
          log.attachment.filename,
        ),
      },
    }),
  }));

  return {
    logs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetch log entries across all sessions/subagents of the named runs, filtered
 * by source. Used by the chat thread to pull a user's LLM commands per run
 * without fanning out a REST call per session.
 */
export async function getAgentRunLogEntries(
  userId: number,
  runIds: number[],
  sources: LogSource[],
  limit: number = AGENT_RUN_LOG_ENTRIES_DEFAULT_LIMIT,
): Promise<AgentRunLogEntriesData> {
  if (runIds.length === 0 || sources.length === 0) {
    return { entries: [], timestamp: new Date().toISOString() };
  }

  const rows = await hubDb.context_log.findMany({
    where: {
      user_id: userId,
      run_id: { in: runIds },
      source: { in: sources },
    },
    orderBy: { id: "desc" },
    take: limit,
    select: {
      id: true,
      run_id: true,
      session_id: true,
      subagent_id: true,
      source: true,
      message: true,
      created_at: true,
    },
  });

  const entries: AgentRunLogEntry[] = rows.map((r) => ({
    logId: r.id,
    runId: r.run_id,
    sessionId: r.session_id,
    subagentId: r.subagent_id === 0 ? undefined : r.subagent_id,
    source: r.source as LogSource,
    message: r.message,
    createdAt: r.created_at.toISOString(),
  }));

  // Reverse so callers get chronological (oldest first); matches how chat
  // ordering works without forcing every consumer to re-sort.
  entries.reverse();

  return {
    entries,
    timestamp: new Date().toISOString(),
  };
}

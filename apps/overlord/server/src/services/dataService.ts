import { Agent, ReadStatus } from "shared";
import { LogEntry } from "shared/src/log-types.js";
import { ThreadMessage } from "shared/src/mail-types.js";
import { getAgents } from "./agentService.js";
import { getLogs } from "./logService.js";
import { getThreadMessages } from "./mailService.js";
import { getReadStatus } from "./readService.js";

export interface NaisysData {
  agents: Agent[];
  logs: LogEntry[];
  mail: ThreadMessage[];
  timestamp: string;
  readStatus: Record<string, ReadStatus>;
}

export async function getNaisysData(
  logsAfter?: number,
  logsLimit: number = 10000,
  mailAfter?: number,
  mailLimit: number = 1000,
): Promise<NaisysData> {
  try {
    // Fetch agents, logs, mail, and read status in parallel
    const [agents, logs, mail] = await Promise.all([
      getAgents(),
      getLogs(logsAfter, logsLimit), // No agent filter - get all logs
      getThreadMessages(mailAfter, mailLimit),
    ]);

    // Important this happens last as getLogs/getThreadMessages() updates read status
    const readStatus = await getReadStatus();

    // For now, use the first user's read status or implement a global read status
    // This assumes there's typically one admin user, but can be enhanced later
    return {
      agents,
      logs,
      mail,
      timestamp: new Date().toISOString(),
      readStatus,
    };
  } catch (error) {
    console.error("Error fetching NAISYS data:", error);

    // Return empty data on error
    return {
      agents: [],
      logs: [],
      mail: [],
      timestamp: new Date().toISOString(),
      readStatus: {},
    };
  }
}

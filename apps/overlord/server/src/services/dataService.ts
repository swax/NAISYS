import { Agent, ReadStatus } from "shared";
import { getAgents } from "./agentService.js";
import { getReadStatus } from "./readService.js";

export interface NaisysData {
  agents: Agent[];
  timestamp: string;
  readStatus: Record<string, ReadStatus>;
}

export async function getNaisysData(): Promise<NaisysData> {
  try {
    // Fetch agents, logs, mail, and read status in parallel
    const agents = await getAgents();

    // Important this happens last as getLogs/getThreadMessages() updates read status
    const readStatus = await getReadStatus();

    // For now, use the first user's read status or implement a global read status
    // This assumes there's typically one admin user, but can be enhanced later
    return {
      agents,
      timestamp: new Date().toISOString(),
      readStatus,
    };
  } catch (error) {
    console.error("Error fetching NAISYS data:", error);

    // Return empty data on error
    return {
      agents: [],
      timestamp: new Date().toISOString(),
      readStatus: {},
    };
  }
}

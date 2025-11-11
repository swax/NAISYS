import { Agent } from "shared";
import { getAgents } from "./agentService.js";

export interface NaisysData {
  agents: Agent[];
  timestamp: string;
}

export async function getNaisysData(): Promise<NaisysData> {
  try {
    // Fetch agents
    const agents = await getAgents();

    return {
      agents,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching NAISYS data:", error);

    // Return empty data on error
    return {
      agents: [],
      timestamp: new Date().toISOString(),
    };
  }
}

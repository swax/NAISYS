import { Agent } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { isAgentOnline } from "../utils/agentUtils.js";

export interface AgentData {
  agents: Agent[];
  timestamp: string;
}

export async function getAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];

  try {
    const users = await usingNaisysDb(async (prisma) => {
      return await prisma.users.findMany({
        select: {
          id: true,
          username: true,
          title: true,
          agent_path: true,
          lead_username: true,
          latest_log_id: true,
          latest_mail_id: true,
          run_sessions: {
            select: {
              last_active: true,
            },
            orderBy: {
              last_active: "desc",
            },
            take: 1,
          },
        },
      });
    });

    users.forEach((user) => {
      const lastActive = user.run_sessions[0]?.last_active || "";
      agents.push({
        id: user.id,
        name: user.username,
        title: user.title,
        online: isAgentOnline(lastActive),
        lastActive: lastActive,
        agentPath: user.agent_path,
        leadUsername: user.lead_username || undefined,
        latestLogId: user.latest_log_id ?? -1,
        latestMailId: user.latest_mail_id ?? -1,
      });
    });
  } catch (error) {
    console.error("Error fetching users from Naisys database:", error);
  }

  return agents;
}

export async function getAgentData(): Promise<AgentData> {
  try {
    // Fetch agents
    const agents = await getAgents();

    return {
      agents,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching agent data:", error);

    // Return empty data on error
    return {
      agents: [],
      timestamp: new Date().toISOString(),
    };
  }
}

import { Agent } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";

export interface AgentData {
  agents: Agent[];
  timestamp: string;
}

export async function getAgents(updatedSince?: string): Promise<Agent[]> {
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
          user_notifications: {
            select: {
              latest_mail_id: true,
              latest_log_id: true,
              last_active: true,
              modified_date: true,
            },
          },
        },
        where: updatedSince
          ? {
              user_notifications: {
                modified_date: { gte: new Date(updatedSince) },
              },
            }
          : undefined,
      });
    });

    users.forEach((user) => {
      agents.push({
        id: user.id,
        name: user.username,
        title: user.title,
        lastActive: user.user_notifications?.last_active.toISOString(),
        agentPath: user.agent_path,
        leadUsername: user.lead_username || undefined,
        latestLogId: user.user_notifications?.latest_log_id ?? -1,
        latestMailId: user.user_notifications?.latest_mail_id ?? -1,
      });
    });
  } catch (error) {
    console.error("Error fetching users from Naisys database:", error);
  }

  return agents;
}

export async function getAgentData(updatedSince?: string): Promise<AgentData> {
  try {
    // Fetch agents
    const agents = await getAgents(updatedSince);

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

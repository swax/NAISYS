import { Agent } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { ONLINE_THRESHOLD_SECONDS } from "../utils/agentUtils.js";

export interface AgentData {
  agents: Agent[];
  timestamp: string;
}

export async function getAgents(updatedSince?: string): Promise<Agent[]> {
  const agents: Agent[] = [];

  try {
    const users = await usingNaisysDb(async (prisma) => {
      const lastActiveThreshold = new Date(
        Date.now() - ONLINE_THRESHOLD_SECONDS * 2 * 1000,
      );

      // If updatedSince set then return agents with active sessions or modifications
      // Else return all agents, fresh update
      const agentFilter = updatedSince
        ? {
            OR: [
              { modified_date: { gte: new Date(updatedSince) } },
              {
                run_sessions: {
                  some: {
                    last_active: { gte: lastActiveThreshold },
                  },
                },
              },
            ],
          }
        : undefined;

      return await prisma.users.findMany({
        select: {
          id: true,
          username: true,
          title: true,
          agent_path: true,
          lead_username: true,
          latest_mail_id: true,
          modified_date: true,
          // Get active sessions only
          run_sessions: {
            select: {
              last_active: true,
              latest_log_id: true,
            },
            where: {
              last_active: {
                gte: lastActiveThreshold,
              },
            },
          },
        },
        where: agentFilter,
      });
    });

    users.forEach((user) => {
      // Get max last_active across all sessions
      const lastActive = user.run_sessions.reduce<Date | undefined>(
        (max, session) => {
          if (!max || session.last_active > max) {
            return session.last_active;
          }
          return max;
        },
        undefined,
      );

      // Get max latest_log_id across all sessions
      const latestLogId = user.run_sessions.reduce<number>(
        (max, session) => Math.max(max, session.latest_log_id),
        -1,
      );

      agents.push({
        id: user.id,
        name: user.username,
        title: user.title,
        lastActive: lastActive?.toISOString(),
        agentPath: user.agent_path,
        leadUsername: user.lead_username || undefined,
        latestLogId,
        latestMailId: user.latest_mail_id ?? -1,
        modifiedDate: user.modified_date.toISOString(),
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

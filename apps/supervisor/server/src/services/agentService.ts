import { Agent, Host } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { cachedForSeconds } from "../utils/cache.js";

export interface AgentData {
  agents: Agent[];
  hosts: Host[];
  timestamp: string;
}

export const getAgents = cachedForSeconds(1, async (updatedSince?: string): Promise<Agent[]> => {
  const agents: Agent[] = [];

  try {
    const [users, latestMailByUser] = await usingNaisysDb(async (prisma) => {
      const usersPromise = prisma.users.findMany({
        select: {
          id: true,
          username: true,
          title: true,
          agent_path: true,
          lead_username: true,
          host: { select: { name: true } },
          user_notifications: {
            select: {
              latest_log_id: true,
              last_active: true,
              updated_at: true,
            },
          },
        },
        where: updatedSince
          ? {
              user_notifications: {
                updated_at: { gte: new Date(updatedSince) },
              },
            }
          : undefined,
      });

      // Compute latest mail ID per user from mail_recipients (avoids cross-host sync issues)
      const latestMailPromise = prisma.mail_recipients.groupBy({
        by: ["user_id"],
        _max: { message_id: true },
      });

      return Promise.all([usersPromise, latestMailPromise]);
    });

    // Build a map of user_id -> latest_mail_id
    const latestMailMap = new Map<string, string>();
    for (const entry of latestMailByUser) {
      if (entry._max.message_id) {
        latestMailMap.set(entry.user_id, entry._max.message_id);
      }
    }

    users.forEach((user) => {
      agents.push({
        id: user.id,
        name: user.username,
        title: user.title,
        host: user.host?.name ?? "",
        lastActive: user.user_notifications?.last_active?.toISOString(),
        agentPath: user.agent_path,
        leadUsername: user.lead_username || undefined,
        latestLogId: user.user_notifications?.latest_log_id ?? "",
        latestMailId: latestMailMap.get(user.id) ?? "",
      });
    });
  } catch (error) {
    console.error("Error fetching users from Naisys database:", error);
  }

  return agents;
});

export const getHosts = cachedForSeconds(1, async (): Promise<Host[]> => {
  try {
    const hosts = await usingNaisysDb(async (prisma) => {
      return prisma.hosts.findMany({
        select: {
          name: true,
          last_active: true,
          _count: {
            select: { users: true },
          },
        },
      });
    });

    return hosts.map((host) => ({
      name: host.name,
      lastActive: host.last_active?.toISOString() ?? null,
      agentCount: host._count.users,
    }));
  } catch (error) {
    console.error("Error fetching hosts from Naisys database:", error);
    return [];
  }
});

export async function getAgentData(updatedSince?: string): Promise<AgentData> {
  try {
    // Fetch agents and hosts in parallel
    const [agents, hosts] = await Promise.all([
      getAgents(updatedSince),
      getHosts(),
    ]);

    return {
      agents,
      hosts,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching agent data:", error);

    // Return empty data on error
    return {
      agents: [],
      hosts: [],
      timestamp: new Date().toISOString(),
    };
  }
}

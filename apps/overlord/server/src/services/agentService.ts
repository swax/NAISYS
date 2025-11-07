import { Agent } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";

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
      });
    });
  } catch (error) {
    console.error("Error fetching users from Naisys database:", error);
  }

  return agents;
}

function isAgentOnline(lastActive: string): boolean {
  const now = new Date();
  const lastActiveDate = new Date(lastActive);
  const diffInSeconds = (now.getTime() - lastActiveDate.getTime()) / 1000;
  return 0 < diffInSeconds && diffInSeconds < 5;
}

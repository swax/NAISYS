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
          agentPath: true,
          leadUsername: true,
          lastActive: true,
        },
      });
    });

    users.forEach((user) => {
      agents.push({
        id: user.id,
        name: user.username,
        title: user.title,
        online: isAgentOnline(user.lastActive || ""),
        lastActive: user.lastActive || "",
        agentPath: user.agentPath,
        leadUsername: user.leadUsername || undefined,
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

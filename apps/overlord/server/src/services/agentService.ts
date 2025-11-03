import sqlite3 from "sqlite3";
import { Agent } from "shared";
import { selectFromNaisysDb } from "../database/naisysDatabase.js";

sqlite3.verbose();

interface NaisysUser {
  id: number;
  username: string;
  title: string;
  agentPath: string;
  leadUsername: string | null;
  lastActive: string;
}

export async function getAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];

  try {
    const users = await selectFromNaisysDb<NaisysUser[]>(
      "SELECT id, username, title, agentPath, leadUsername, lastActive FROM Users",
      [],
    );

    users.forEach((user) => {
      agents.push({
        id: user.id,
        name: user.username,
        title: user.title,
        online: isAgentOnline(user.lastActive),
        lastActive: user.lastActive,
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

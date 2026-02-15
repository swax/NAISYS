import { Agent, AgentDetailResponse, Host } from "@naisys-supervisor/shared";
import fs from "fs/promises";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { getLogger } from "../logger.js";
import { cachedForSeconds } from "../utils/cache.js";

export const getAgents = cachedForSeconds(
  0.25,
  async (updatedSince?: string): Promise<Agent[]> => {
    const agents: Agent[] = [];

    try {
      const users = await usingNaisysDb(async (prisma) => {
        return prisma.users.findMany({
          select: {
            id: true,
            username: true,
            title: true,
            archived: true,
            lead_user: { select: { username: true } },
            user_notifications: {
              select: {
                latest_log_id: true,
                latest_mail_id: true,
                last_active: true,
                updated_at: true,
                host: { select: { name: true } },
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
      });

      users.forEach((user) => {
        agents.push({
          id: user.id,
          name: user.username,
          title: user.title,
          host: user.user_notifications?.host?.name ?? "",
          lastActive: user.user_notifications?.last_active?.toISOString(),
          leadUsername: user.lead_user?.username || undefined,
          latestLogId: user.user_notifications?.latest_log_id ?? 0,
          latestMailId: user.user_notifications?.latest_mail_id ?? 0,
          archived: user.archived,
        });
      });
    } catch (error) {
      getLogger().error(error, "Error fetching users from Naisys database");
    }

    return agents;
  },
);

export async function getAgent(
  id: number,
): Promise<AgentDetailResponse | null> {
  try {
    const user = await usingNaisysDb(async (prisma) => {
      return prisma.users.findUnique({
        where: { id },
        select: {
          id: true,
          username: true,
          title: true,
          archived: true,
          agent_path: true,
          lead_user: { select: { username: true } },
          user_notifications: {
            select: {
              latest_log_id: true,
              latest_mail_id: true,
              last_active: true,
              updated_at: true,
              host: { select: { name: true } },
            },
          },
        },
      });
    });

    if (!user) {
      return null;
    }

    let config = "";
    let configPath = user.agent_path;

    try {
      config = await fs.readFile(user.agent_path, "utf-8");
    } catch {
      // Config file may not exist yet
    }

    return {
      id: user.id,
      name: user.username,
      title: user.title,
      host: user.user_notifications?.host?.name ?? "",
      lastActive: user.user_notifications?.last_active?.toISOString(),
      leadUsername: user.lead_user?.username || undefined,
      latestLogId: user.user_notifications?.latest_log_id ?? 0,
      latestMailId: user.user_notifications?.latest_mail_id ?? 0,
      archived: user.archived,
      config,
      configPath,
      _links: [],
    };
  } catch (error) {
    getLogger().error(error, "Error fetching agent detail");
    return null;
  }
}

export async function archiveAgent(id: number): Promise<void> {
  await usingNaisysDb(async (prisma) => {
    await prisma.users.update({
      where: { id },
      data: { archived: true },
    });
  });
}

export async function unarchiveAgent(id: number): Promise<void> {
  await usingNaisysDb(async (prisma) => {
    await prisma.users.update({
      where: { id },
      data: { archived: false },
    });
  });
}

export async function deleteAgent(
  id: number,
): Promise<{ agentPath: string }> {
  return await usingNaisysDb(async (prisma) => {
    const user = await prisma.users.findUnique({
      where: { id },
      select: { agent_path: true },
    });

    if (!user) {
      throw new Error(`Agent with ID ${id} not found`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.context_log.deleteMany({ where: { user_id: id } });
      await tx.costs.deleteMany({ where: { user_id: id } });
      await tx.run_session.deleteMany({ where: { user_id: id } });
      await tx.mail_messages.updateMany({
        where: { from_user_id: id },
        data: { from_user_id: null },
      });
      await tx.mail_recipients.deleteMany({ where: { user_id: id } });
      await tx.user_notifications.deleteMany({ where: { user_id: id } });
      await tx.user_hosts.deleteMany({ where: { user_id: id } });
      await tx.users.updateMany({
        where: { lead_user_id: id },
        data: { lead_user_id: null },
      });
      await tx.users.delete({ where: { id } });
    });

    return { agentPath: user.agent_path };
  });
}

export const getHosts = cachedForSeconds(0.25, async (): Promise<Host[]> => {
  try {
    const hosts = await usingNaisysDb(async (prisma) => {
      return prisma.hosts.findMany({
        select: {
          id: true,
          name: true,
          last_active: true,
          _count: {
            select: { user_hosts: true },
          },
        },
      });
    });

    return hosts.map((host) => ({
      id: host.id,
      name: host.name,
      lastActive: host.last_active?.toISOString() ?? null,
      agentCount: host._count.user_hosts,
    }));
  } catch (error) {
    getLogger().error(error, "Error fetching hosts from Naisys database");
    return [];
  }
});

import { AgentConfigFile, AgentConfigFileSchema } from "@naisys/common";
import { Agent, AgentDetailResponse, Host } from "@naisys-supervisor/shared";
import { hubDb } from "../database/hubDb.js";
import { getLogger } from "../logger.js";
import { cachedForSeconds } from "../utils/cache.js";

export type AgentWithConfig = Agent & { config?: AgentConfigFile | null };

export const getAgents = cachedForSeconds(
  0.25,
  async (updatedSince?: string): Promise<AgentWithConfig[]> => {
    const agents: AgentWithConfig[] = [];

    try {
      const users = await hubDb.users.findMany({
        select: {
          id: true,
          uuid: true,
          username: true,
          title: true,
          archived: true,
          config: true,
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

      users.forEach((user) => {
        agents.push({
          id: user.id,
          uuid: user.uuid,
          name: user.username,
          title: user.title,
          host: user.user_notifications?.host?.name ?? "",
          lastActive: user.user_notifications?.last_active?.toISOString(),
          leadUsername: user.lead_user?.username || undefined,
          latestLogId: user.user_notifications?.latest_log_id ?? 0,
          latestMailId: user.user_notifications?.latest_mail_id ?? 0,
          archived: user.archived,
          config: parseConfig(user.config),
        });
      });
    } catch (error) {
      getLogger().error(error, "Error fetching users from Naisys database");
    }

    return agents;
  },
);

function parseConfig(config: string | null): AgentConfigFile | null {
  if (!config) return null;
  try {
    return AgentConfigFileSchema.parse(JSON.parse(config));
  } catch {
    return null;
  }
}

export async function getHubAgentById(id: number) {
  return hubDb.users.findUnique({
    where: { id },
    select: { id: true, uuid: true, username: true },
  });
}

export async function getHubAgentByUuid(uuid: string) {
  return hubDb.users.findFirst({
    where: { uuid },
    select: { id: true },
  });
}

export async function getAgent(
  id: number,
): Promise<AgentDetailResponse | null> {
  try {
    const user = await hubDb.users.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        title: true,
        archived: true,
        config: true,
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

    if (!user) {
      return null;
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
      config: parseConfig(user.config)!,
      _links: [],
    };
  } catch (error) {
    getLogger().error(error, "Error fetching agent detail");
    return null;
  }
}

export async function archiveAgent(id: number): Promise<void> {
  await hubDb.users.update({
    where: { id },
    data: { archived: true },
  });
}

export async function unarchiveAgent(id: number): Promise<void> {
  await hubDb.users.update({
    where: { id },
    data: { archived: false },
  });
}

export async function updateLeadAgent(
  id: number,
  leadUserId: number | null,
): Promise<void> {
  const agent = await hubDb.users.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!agent) {
    throw new Error(`Agent with ID ${id} not found`);
  }

  if (leadUserId) {
    const leadAgent = await hubDb.users.findUnique({
      where: { id: leadUserId },
      select: { id: true },
    });

    if (!leadAgent) {
      throw new Error(`Lead agent with ID ${leadUserId} not found`);
    }
  }

  await hubDb.users.update({
    where: { id },
    data: { lead_user_id: leadUserId },
  });
}

export async function deleteAgent(id: number): Promise<void> {
  const user = await hubDb.users.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`Agent with ID ${id} not found`);
  }

  await hubDb.$transaction(async (tx) => {
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
}

export async function deleteHost(id: number): Promise<void> {
  await hubDb.$transaction(async (tx) => {
    await tx.context_log.deleteMany({ where: { host_id: id } });
    await tx.costs.deleteMany({ where: { host_id: id } });
    await tx.run_session.deleteMany({ where: { host_id: id } });
    await tx.mail_messages.updateMany({
      where: { host_id: id },
      data: { host_id: null },
    });
    await tx.user_notifications.updateMany({
      where: { latest_host_id: id },
      data: { latest_host_id: null },
    });
    await tx.user_hosts.deleteMany({ where: { host_id: id } });
    await tx.hosts.delete({ where: { id } });
  });
}

export const getHosts = cachedForSeconds(0.25, async (): Promise<Host[]> => {
  try {
    const hosts = await hubDb.hosts.findMany({
      select: {
        id: true,
        name: true,
        last_active: true,
        _count: {
          select: { user_hosts: true },
        },
      },
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

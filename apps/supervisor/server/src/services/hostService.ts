import type { Host, HostDetailResponse } from "@naisys-supervisor/shared";

import { hubDb } from "../database/hubDb.js";
import { getLogger } from "../logger.js";
import { cachedForSeconds } from "../utils/cache.js";

export const getHosts = cachedForSeconds(0.25, async (): Promise<Host[]> => {
  try {
    const hosts = await hubDb.hosts.findMany({
      select: {
        id: true,
        name: true,
        restricted: true,
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
      restricted: host.restricted,
    }));
  } catch (error) {
    getLogger().error(error, "Error fetching hosts from Naisys database");
    return [];
  }
});

export async function getHostDetail(
  hostId: number,
): Promise<HostDetailResponse | null> {
  try {
    const host = await hubDb.hosts.findUnique({
      where: { id: hostId },
      select: {
        id: true,
        name: true,
        restricted: true,
        last_active: true,
        user_hosts: {
          select: {
            users: {
              select: { id: true, username: true, title: true },
            },
          },
        },
      },
    });

    if (!host) return null;

    return {
      id: host.id,
      name: host.name,
      lastActive: host.last_active?.toISOString() ?? null,
      restricted: host.restricted,
      online: false, // Caller sets this from agentHostStatusService
      assignedAgents: host.user_hosts.map((uh) => ({
        id: uh.users.id,
        name: uh.users.username,
        title: uh.users.title,
      })),
      _links: [],
    };
  } catch (error) {
    getLogger().error(error, "Error fetching host detail");
    return null;
  }
}

export async function createHost(name: string): Promise<{ id: number }> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      "Host name must contain only alphanumeric characters, hyphens, and underscores",
    );
  }

  const existing = await hubDb.hosts.findUnique({ where: { name } });
  if (existing) {
    throw new Error(`Host with name "${name}" already exists`);
  }

  const host = await hubDb.hosts.create({
    data: { name },
  });

  return { id: host.id };
}

export async function updateHost(
  hostId: number,
  data: { name?: string; restricted?: boolean },
): Promise<void> {
  const host = await hubDb.hosts.findUnique({ where: { id: hostId } });
  if (!host) {
    throw new Error(`Host with ID ${hostId} not found`);
  }

  if (data.name && data.name !== host.name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.name)) {
      throw new Error(
        "Host name must contain only alphanumeric characters, hyphens, and underscores",
      );
    }

    const existing = await hubDb.hosts.findUnique({
      where: { name: data.name },
    });
    if (existing) {
      throw new Error(`Host with name "${data.name}" already exists`);
    }
  }

  await hubDb.hosts.update({
    where: { id: hostId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.restricted !== undefined ? { restricted: data.restricted } : {}),
    },
  });
}

export async function assignAgentToHost(
  hostId: number,
  agentId: number,
): Promise<void> {
  const host = await hubDb.hosts.findUnique({ where: { id: hostId } });
  if (!host) {
    throw new Error(`Host with ID ${hostId} not found`);
  }

  const agent = await hubDb.users.findUnique({ where: { id: agentId } });
  if (!agent) {
    throw new Error(`Agent with ID ${agentId} not found`);
  }

  const existing = await hubDb.user_hosts.findUnique({
    where: { user_id_host_id: { user_id: agentId, host_id: hostId } },
  });
  if (existing) {
    throw new Error("Agent is already assigned to this host");
  }

  await hubDb.user_hosts.create({
    data: { user_id: agentId, host_id: hostId },
  });
}

export async function unassignAgentFromHost(
  hostId: number,
  agentId: number,
): Promise<void> {
  const existing = await hubDb.user_hosts.findUnique({
    where: { user_id_host_id: { user_id: agentId, host_id: hostId } },
  });
  if (!existing) {
    throw new Error("Agent is not assigned to this host");
  }

  await hubDb.user_hosts.delete({
    where: { user_id_host_id: { user_id: agentId, host_id: hostId } },
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

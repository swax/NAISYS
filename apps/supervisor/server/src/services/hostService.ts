import { assertUrlSafeKey } from "@naisys/common";
import type { HostEnvironment } from "@naisys/supervisor-shared";
import { HostEnvironmentSchema } from "@naisys/supervisor-shared";

import { hubDb } from "../database/hubDb.js";
import { resolveAgentId } from "./agentService.js";

export async function getHosts() {
  const hosts = await hubDb.hosts.findMany({
    select: {
      id: true,
      name: true,
      restricted: true,
      host_type: true,
      last_active: true,
      last_version: true,
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
    hostType: host.host_type,
    lastVersion: host.last_version ?? "",
  }));
}

export async function getHostDetail(hostname: string) {
  const host = await hubDb.hosts.findUnique({
    where: { name: hostname },
    select: {
      id: true,
      name: true,
      machine_id: true,
      restricted: true,
      host_type: true,
      last_active: true,
      last_ip: true,
      last_version: true,
      environment: true,
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
    machineId: host.machine_id ?? null,
    lastActive: host.last_active?.toISOString() ?? null,
    lastIp: host.last_ip ?? null,
    restricted: host.restricted,
    hostType: host.host_type,
    online: false, // Caller overrides from agentHostStatusService
    version: "", // Caller overrides from agentHostStatusService
    lastVersion: host.last_version ?? "",
    environment: parseEnvironment(host.environment),
    assignedAgents: host.user_hosts.map((uh) => ({
      id: uh.users.id,
      name: uh.users.username,
      title: uh.users.title,
    })),
    _links: [],
  };
}

function parseEnvironment(raw: string | null): HostEnvironment | null {
  if (!raw) return null;
  try {
    const parsed = HostEnvironmentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function createHost(name: string): Promise<{ id: number }> {
  assertUrlSafeKey(name, "Host name");

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
  hostname: string,
  data: { name?: string; restricted?: boolean },
): Promise<void> {
  const host = await hubDb.hosts.findUnique({ where: { name: hostname } });
  if (!host) {
    throw new Error(`Host "${hostname}" not found`);
  }

  if (data.name && data.name !== host.name) {
    assertUrlSafeKey(data.name, "Host name");

    const existing = await hubDb.hosts.findUnique({
      where: { name: data.name },
    });
    if (existing) {
      throw new Error(`Host with name "${data.name}" already exists`);
    }
  }

  await hubDb.hosts.update({
    where: { name: hostname },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.restricted !== undefined ? { restricted: data.restricted } : {}),
    },
  });
}

export async function assignAgentToHost(
  hostname: string,
  agentId: number,
): Promise<void> {
  const host = await hubDb.hosts.findUnique({ where: { name: hostname } });
  if (!host) {
    throw new Error(`Host "${hostname}" not found`);
  }

  if (host.host_type === "supervisor") {
    throw new Error("Cannot assign agents to a supervisor host");
  }

  const agent = await hubDb.users.findUnique({ where: { id: agentId } });
  if (!agent) {
    throw new Error(`Agent with ID ${agentId} not found`);
  }

  const existing = await hubDb.user_hosts.findUnique({
    where: { user_id_host_id: { user_id: agentId, host_id: host.id } },
  });
  if (existing) {
    throw new Error("Agent is already assigned to this host");
  }

  await hubDb.user_hosts.create({
    data: { user_id: agentId, host_id: host.id },
  });
}

export async function unassignAgentFromHost(
  hostname: string,
  agentName: string,
): Promise<void> {
  const host = await hubDb.hosts.findUnique({ where: { name: hostname } });
  if (!host) {
    throw new Error(`Host "${hostname}" not found`);
  }

  const agentId = resolveAgentId(agentName);
  if (!agentId) {
    throw new Error(`Agent "${agentName}" not found`);
  }

  const existing = await hubDb.user_hosts.findUnique({
    where: { user_id_host_id: { user_id: agentId, host_id: host.id } },
  });
  if (!existing) {
    throw new Error("Agent is not assigned to this host");
  }

  await hubDb.user_hosts.delete({
    where: { user_id_host_id: { user_id: agentId, host_id: host.id } },
  });
}

export async function deleteHost(hostname: string): Promise<void> {
  const host = await hubDb.hosts.findUnique({ where: { name: hostname } });
  if (!host) {
    throw new Error(`Host "${hostname}" not found`);
  }

  const id = host.id;
  await hubDb.$transaction(async (hubTx) => {
    await hubTx.context_log.deleteMany({ where: { host_id: id } });
    await hubTx.costs.deleteMany({ where: { host_id: id } });
    await hubTx.run_session.deleteMany({ where: { host_id: id } });
    await hubTx.mail_messages.updateMany({
      where: { host_id: id },
      data: { host_id: null },
    });
    await hubTx.user_notifications.updateMany({
      where: { latest_host_id: id },
      data: { latest_host_id: null },
    });
    await hubTx.user_hosts.deleteMany({ where: { host_id: id } });
    await hubTx.hosts.delete({ where: { id } });
  });
}

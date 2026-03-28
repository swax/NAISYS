import {
  AgentConfigFile,
  AgentConfigFileSchema,
  calculatePeriodBoundaries,
} from "@naisys/common";
import { Agent, AgentDetailResponse } from "@naisys-supervisor/shared";

import { hubDb } from "../database/hubDb.js";
import {
  updateAgentEnabledStatus,
  updateAgentHostAssignments,
  updateCostSuspendedAgents,
} from "./agentHostStatusService.js";

export type AgentWithConfig = Agent & { config?: AgentConfigFile | null };

export async function getAgents(
  updatedSince?: string,
): Promise<AgentWithConfig[]> {
  const users = await hubDb.users.findMany({
    select: {
      id: true,
      uuid: true,
      username: true,
      title: true,
      enabled: true,
      archived: true,
      config: true,
      lead_user: { select: { username: true } },
      user_hosts: { select: { host_id: true } },
      user_notifications: {
        select: {
          latest_log_id: true,
          latest_mail_id: true,
          last_active: true,
          cost_suspended_reason: true,
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

  const agents: AgentWithConfig[] = users.map((user) => ({
    id: user.id,
    uuid: user.uuid,
    name: user.username,
    title: user.title,
    host: user.user_notifications?.host?.name ?? "",
    lastActive: user.user_notifications?.last_active?.toISOString(),
    leadUsername: user.lead_user?.username || undefined,
    latestLogId: user.user_notifications?.latest_log_id ?? 0,
    latestMailId: user.user_notifications?.latest_mail_id ?? 0,
    enabled: user.enabled,
    archived: user.archived,
    config: parseConfig(user.config),
  }));

  updateAgentHostAssignments(
    users.map((user) => ({
      agentId: user.id,
      hostIds: user.user_hosts.map((uh) => uh.host_id),
    })),
  );

  updateCostSuspendedAgents(
    users.map((user) => ({
      agentId: user.id,
      isSuspended: !!user.user_notifications?.cost_suspended_reason,
    })),
  );

  updateAgentEnabledStatus(
    users.map((user) => ({
      agentId: user.id,
      enabled: user.enabled,
    })),
  );

  return agents;
}

function parseConfig(config: string | null): AgentConfigFile | null {
  if (!config) return null;
  try {
    return AgentConfigFileSchema.parse(JSON.parse(config));
  } catch {
    return null;
  }
}

// In-memory bidirectional lookup, refreshed by refreshUserLookup()
const idToUsername = new Map<number, string>();
const usernameToId = new Map<string, number>();

export function resolveAgentId(username: string): number | undefined {
  return usernameToId.get(username);
}

export function resolveUsername(userId: number): string | undefined {
  return idToUsername.get(userId);
}

export async function refreshUserLookup(): Promise<void> {
  const users = await hubDb.users.findMany({
    select: { id: true, username: true },
  });
  idToUsername.clear();
  usernameToId.clear();
  for (const user of users) {
    idToUsername.set(user.id, user.username);
    usernameToId.set(user.username, user.id);
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
    select: { id: true, username: true },
  });
}

export async function getAgent(
  id: number,
): Promise<AgentDetailResponse | null> {
  const user = await hubDb.users.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      title: true,
      enabled: true,
      archived: true,
      config: true,
      lead_user: { select: { username: true } },
      user_hosts: {
        select: {
          host_id: true,
          host: { select: { id: true, name: true } },
        },
      },
      user_notifications: {
        select: {
          latest_log_id: true,
          latest_mail_id: true,
          last_active: true,
          cost_suspended_reason: true,
          spend_limit_reset_at: true,
          updated_at: true,
          host: { select: { name: true } },
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  updateAgentHostAssignments([
    {
      agentId: user.id,
      hostIds: user.user_hosts.map((uh) => uh.host_id),
    },
  ]);

  const config = parseConfig(user.config)!;
  const currentSpend = await getAgentCurrentSpend(
    user.id,
    config.spendLimitDollars,
    config.spendLimitHours,
    user.user_notifications?.spend_limit_reset_at ?? null,
  );

  return {
    id: user.id,
    name: user.username,
    title: user.title,
    host: user.user_notifications?.host?.name ?? "",
    lastActive: user.user_notifications?.last_active?.toISOString(),
    leadUsername: user.lead_user?.username || undefined,
    latestLogId: user.user_notifications?.latest_log_id ?? 0,
    latestMailId: user.user_notifications?.latest_mail_id ?? 0,
    enabled: user.enabled,
    archived: user.archived,
    costSuspendedReason:
      user.user_notifications?.cost_suspended_reason ?? undefined,
    currentSpend,
    spendLimitResetAt:
      user.user_notifications?.spend_limit_reset_at?.toISOString() ?? undefined,
    config,
    assignedHosts: user.user_hosts.map((uh) => ({
      id: uh.host.id,
      name: uh.host.name,
    })),
    _links: [],
  };
}

export async function enableAgent(id: number): Promise<void> {
  await hubDb.users.update({
    where: { id },
    data: { enabled: true },
  });
}

export async function disableAgent(id: number): Promise<void> {
  await hubDb.users.update({
    where: { id },
    data: { enabled: false },
  });
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
  leadUsername: string | null,
): Promise<void> {
  const agent = await hubDb.users.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!agent) {
    throw new Error(`Agent with ID ${id} not found`);
  }

  let leadUserId: number | null = null;
  if (leadUsername) {
    const leadAgent = await hubDb.users.findUnique({
      where: { username: leadUsername },
      select: { id: true },
    });

    if (!leadAgent) {
      throw new Error(`Lead agent '${leadUsername}' not found`);
    }
    leadUserId = leadAgent.id;
  }

  await hubDb.users.update({
    where: { id },
    data: { lead_user_id: leadUserId },
  });
}

async function getAgentCurrentSpend(
  userId: number,
  spendLimitDollars: number | undefined,
  spendLimitHours: number | undefined,
  spendLimitResetAt: Date | null,
): Promise<number | undefined> {
  if (spendLimitDollars === undefined) return undefined;

  const where: Record<string, unknown> = { user_id: userId };

  let effectiveStart: Date | undefined;
  if (spendLimitHours !== undefined) {
    const { periodStart } = calculatePeriodBoundaries(spendLimitHours);
    effectiveStart = periodStart;
  }
  if (
    spendLimitResetAt &&
    (!effectiveStart || spendLimitResetAt > effectiveStart)
  ) {
    effectiveStart = spendLimitResetAt;
  }
  if (effectiveStart) {
    where.created_at = { gte: effectiveStart };
  }

  const result = await hubDb.costs.aggregate({
    where,
    _sum: { cost: true },
  });
  return Math.round((result._sum.cost ?? 0) * 100) / 100;
}

export async function resetAgentSpend(id: number): Promise<void> {
  await hubDb.user_notifications.updateMany({
    where: { user_id: id },
    data: {
      spend_limit_reset_at: new Date(),
      cost_suspended_reason: null,
    },
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

  await hubDb.$transaction(async (hubTx) => {
    await hubTx.context_log.deleteMany({ where: { user_id: id } });
    await hubTx.costs.deleteMany({ where: { user_id: id } });
    await hubTx.run_session.deleteMany({ where: { user_id: id } });

    // Get sent message IDs so we can delete their attachments and recipients
    const sentMessages = await hubTx.mail_messages.findMany({
      where: { from_user_id: id },
      select: { id: true },
    });
    const sentMessageIds = sentMessages.map((m) => m.id);
    if (sentMessageIds.length > 0) {
      await hubTx.mail_attachments.deleteMany({
        where: { message_id: { in: sentMessageIds } },
      });
      await hubTx.mail_recipients.deleteMany({
        where: { message_id: { in: sentMessageIds } },
      });
      await hubTx.mail_messages.deleteMany({
        where: { id: { in: sentMessageIds } },
      });
    }

    // Delete remaining recipient entries (for messages received by this agent)
    await hubTx.mail_recipients.deleteMany({ where: { user_id: id } });
    await hubTx.user_notifications.deleteMany({ where: { user_id: id } });
    await hubTx.user_hosts.deleteMany({ where: { user_id: id } });
    await hubTx.users.updateMany({
      where: { lead_user_id: id },
      data: { lead_user_id: null },
    });
    await hubTx.users.delete({ where: { id } });
  });
}

import { EventEmitter } from "node:events";

import type { AgentStatusEvent } from "@naisys-supervisor/shared";

const activeAgentIds = new Set<number>();
const connectedHostIds = new Set<number>();
const agentNotifications = new Map<
  number,
  { latestLogId: number; latestMailId: number }
>();
const hostOnlineStatus = new Map<number, boolean>();
const agentHostAssignments = new Map<number, number[]>();

const statusEmitter = new EventEmitter();

// --- Mutation functions (called by hubConnectionService event handlers) ---

export function updateAgentsStatus(
  hostActiveAgents: Record<string, number[]>,
  notifications?: Record<string, { latestLogId: number; latestMailId: number }>,
): void {
  activeAgentIds.clear();
  connectedHostIds.clear();
  for (const [hostId, userIds] of Object.entries(hostActiveAgents)) {
    connectedHostIds.add(Number(hostId));
    for (const id of userIds) {
      activeAgentIds.add(id);
    }
  }

  if (notifications) {
    for (const [key, value] of Object.entries(notifications)) {
      agentNotifications.set(Number(key), value);
    }
  }

  statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
}

export function updateHostsStatus(
  hosts: { hostId: number; online: boolean }[],
): void {
  hostOnlineStatus.clear();
  connectedHostIds.clear();
  for (const host of hosts) {
    hostOnlineStatus.set(host.hostId, host.online);
    if (host.online) {
      connectedHostIds.add(host.hostId);
    }
  }

  statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
}

export function markAgentStarted(userId: number): void {
  activeAgentIds.add(userId);
  statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
}

export function markAgentStopped(userId: number): void {
  activeAgentIds.delete(userId);
  statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
}

export function emitListChanged(): void {
  statusEmitter.emit("agentStatusUpdate", {
    ...getAgentStatusSnapshot(),
    listChanged: true,
  });
}

// --- Agent host assignment cache ---

export function updateAgentHostAssignments(
  assignments: { agentId: number; hostIds: number[] }[],
): void {
  for (const { agentId, hostIds } of assignments) {
    agentHostAssignments.set(agentId, hostIds);
  }
}

// --- Query functions ---

export function isAgentActive(userId: number): boolean {
  return activeAgentIds.has(userId);
}

export function getAgentStatus(
  agentId: number,
): "active" | "available" | "offline" {
  if (activeAgentIds.has(agentId)) return "active";

  const assignedHostIds = agentHostAssignments.get(agentId);
  if (!assignedHostIds || assignedHostIds.length === 0) return "available";

  const anyHostOnline = assignedHostIds.some((hid) =>
    connectedHostIds.has(hid),
  );
  return anyHostOnline ? "available" : "offline";
}

export function isHostConnected(hostId: number): boolean {
  return connectedHostIds.has(hostId);
}

/** Build a snapshot of all agent statuses from current state */
export function getAgentStatusSnapshot(): AgentStatusEvent {
  const agents: AgentStatusEvent["agents"] = {};

  // Include all agents we know about from notifications
  for (const [userId, notif] of agentNotifications) {
    agents[String(userId)] = {
      status: getAgentStatus(userId),
      latestLogId: notif.latestLogId,
      latestMailId: notif.latestMailId,
    };
  }

  // Include active agents that may not have notifications yet
  for (const userId of activeAgentIds) {
    if (!agents[String(userId)]) {
      agents[String(userId)] = {
        status: "active",
        latestLogId: 0,
        latestMailId: 0,
      };
    }
  }

  const hosts: NonNullable<AgentStatusEvent["hosts"]> = {};
  for (const [hostId, online] of hostOnlineStatus) {
    hosts[String(hostId)] = { online };
  }

  return { agents, hosts };
}

/** Subscribe to agent status updates. Returns an unsubscribe function. */
export function onAgentStatusUpdate(
  listener: (event: AgentStatusEvent) => void,
): () => void {
  statusEmitter.on("agentStatusUpdate", listener);
  return () => {
    statusEmitter.off("agentStatusUpdate", listener);
  };
}

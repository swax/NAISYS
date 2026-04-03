import { type AgentStatus, determineAgentStatus } from "@naisys/common";
import type {
  AgentStatusEvent,
  HostStatusEvent,
  HubStatusEvent,
} from "@naisys/supervisor-shared";

import { getIO } from "./browserSocketService.js";

const activeAgentIds = new Set<number>();
const disabledAgentIds = new Set<number>();
const costSuspendedAgentIds = new Set<number>();
const connectedHostIds = new Set<number>();
const agentNotifications = new Map<
  number,
  { latestLogId: number; latestMailId: number }
>();
const hostOnlineStatus = new Map<number, boolean>();
const hostRestrictedStatus = new Map<number, boolean>();
const hostTypeStatus = new Map<number, string>();
const agentHostAssignments = new Map<number, number[]>();

function broadcast<T>(room: string, event: T) {
  try {
    getIO().to(room).emit(room, event);
  } catch {
    // Socket.IO not yet initialized during startup — safe to ignore
  }
}

function broadcastAgentStatus(event: AgentStatusEvent) {
  broadcast("agent-status", event);
}

function broadcastHostStatus(event: HostStatusEvent) {
  broadcast("host-status", event);
}

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

  broadcastAgentStatus(getAgentSnapshot());
}

export function updateHostsStatus(
  hosts: {
    hostId: number;
    online: boolean;
    restricted: boolean;
    hostType: string;
  }[],
): void {
  // Detect if the set of host IDs changed
  const newHostIds = new Set(hosts.map((h) => h.hostId));
  const prevHostIds = new Set(hostOnlineStatus.keys());
  const hostSetChanged =
    newHostIds.size !== prevHostIds.size ||
    [...newHostIds].some((id) => !prevHostIds.has(id));

  hostOnlineStatus.clear();
  hostRestrictedStatus.clear();
  hostTypeStatus.clear();
  connectedHostIds.clear();
  for (const host of hosts) {
    hostOnlineStatus.set(host.hostId, host.online);
    hostRestrictedStatus.set(host.hostId, host.restricted);
    hostTypeStatus.set(host.hostId, host.hostType);
    if (host.online) {
      connectedHostIds.add(host.hostId);
    }
  }

  // Host topology changes can affect agent statuses (available/offline)
  broadcastAgentStatus(getAgentSnapshot());

  const hostEvent = getHostSnapshot();
  if (hostSetChanged) {
    hostEvent.hostsListChanged = true;
  }
  broadcastHostStatus(hostEvent);
}

export function markAgentStarted(userId: number): void {
  activeAgentIds.add(userId);
  broadcastAgentStatus(getAgentSnapshot());
}

export function markAgentStopped(userId: number): void {
  activeAgentIds.delete(userId);
  broadcastAgentStatus(getAgentSnapshot());
}

export function emitAgentsListChanged(): void {
  broadcastAgentStatus({
    ...getAgentSnapshot(),
    agentsListChanged: true,
  });
}

export function emitHostsListChanged(): void {
  broadcastHostStatus({
    ...getHostSnapshot(),
    hostsListChanged: true,
  });
}

export function emitHubConnectionStatus(connected: boolean): void {
  const event: HubStatusEvent = { hubConnected: connected };
  broadcast("hub-status", event);
}

// --- Agent host assignment cache ---

export function updateAgentHostAssignments(
  assignments: { agentId: number; hostIds: number[] }[],
): void {
  for (const { agentId, hostIds } of assignments) {
    agentHostAssignments.set(agentId, hostIds);
  }
}

// --- Enabled status cache ---

export function updateAgentEnabledStatus(
  agents: { agentId: number; enabled: boolean }[],
): void {
  for (const { agentId, enabled } of agents) {
    if (!enabled) {
      disabledAgentIds.add(agentId);
    } else {
      disabledAgentIds.delete(agentId);
    }
  }
}

// --- Cost suspension cache ---

export function updateCostSuspendedAgents(
  agents: { agentId: number; isSuspended: boolean }[],
): void {
  for (const { agentId, isSuspended } of agents) {
    if (isSuspended) {
      costSuspendedAgentIds.add(agentId);
    } else {
      costSuspendedAgentIds.delete(agentId);
    }
  }
}

// --- Query functions ---

export function isAgentActive(userId: number): boolean {
  return activeAgentIds.has(userId);
}

function hasNonRestrictedOnlineHost(): boolean {
  for (const [hostId, online] of hostOnlineStatus) {
    if (
      online &&
      !hostRestrictedStatus.get(hostId) &&
      hostTypeStatus.get(hostId) === "naisys"
    )
      return true;
  }
  return false;
}

export function getAgentStatus(agentId: number): AgentStatus {
  return determineAgentStatus({
    isActive: activeAgentIds.has(agentId),
    isEnabled: !disabledAgentIds.has(agentId),
    isSuspended: costSuspendedAgentIds.has(agentId),
    assignedHostIds: agentHostAssignments.get(agentId),
    isHostOnline: (hid) => connectedHostIds.has(hid),
    hasNonRestrictedOnlineHost: hasNonRestrictedOnlineHost(),
  });
}

export function isHostConnected(hostId: number): boolean {
  return connectedHostIds.has(hostId);
}

/** Build a snapshot of all agent statuses from current state */
function getAgentSnapshot(): AgentStatusEvent {
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

  return { agents };
}

/** Build a snapshot of all host online statuses from current state */
function getHostSnapshot(): HostStatusEvent {
  const hosts: HostStatusEvent["hosts"] = {};
  for (const [hostId, online] of hostOnlineStatus) {
    hosts[String(hostId)] = { online };
  }
  return { hosts };
}

import { type AgentStatus, determineAgentStatus } from "@naisys/common";
import type {
  AgentStatusEvent,
  HostStatusEvent,
  HubStatusEvent,
} from "@naisys/supervisor-shared";

import { getIO } from "./browserSocketService.js";

const activeAgentIds = new Set<number>();
const pausedAgentIds = new Set<number>();
const disabledAgentIds = new Set<number>();
const costSuspendedAgentIds = new Set<number>();
const connectedHostIds = new Set<number>();
const agentNotifications = new Map<
  number,
  { latestLogId: number; latestMailId: number }
>();
const activeSubagentCounts = new Map<
  string,
  { userId: number; runId: number; count: number }
>();

interface HostState {
  online: boolean;
  restricted: boolean;
  hostType: string;
  version: string;
}
const hostStates = new Map<number, HostState>();

const agentHostAssignments = new Map<number, number[]>();

const parentRunKey = (userId: number, runId: number) => `${userId}-${runId}`;

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
  const nextActiveAgentIds = new Set<number>();
  for (const userIds of Object.values(hostActiveAgents)) {
    for (const id of userIds) {
      nextActiveAgentIds.add(id);
    }
  }

  for (const [key, entry] of activeSubagentCounts) {
    if (nextActiveAgentIds.has(entry.userId)) continue;
    activeSubagentCounts.delete(key);
  }

  activeAgentIds.clear();
  for (const id of nextActiveAgentIds) {
    activeAgentIds.add(id);
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
    version: string;
  }[],
): void {
  // Detect if the set of host IDs changed
  const newHostIds = new Set(hosts.map((h) => h.hostId));
  const prevHostIds = new Set(hostStates.keys());
  const hostSetChanged =
    newHostIds.size !== prevHostIds.size ||
    [...newHostIds].some((id) => !prevHostIds.has(id));

  hostStates.clear();
  connectedHostIds.clear();
  for (const host of hosts) {
    hostStates.set(host.hostId, {
      online: host.online,
      restricted: host.restricted,
      hostType: host.hostType,
      version: host.version,
    });
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
  pausedAgentIds.delete(userId);
  for (const [key, entry] of activeSubagentCounts) {
    if (entry.userId === userId) activeSubagentCounts.delete(key);
  }
  broadcastAgentStatus(getAgentSnapshot());
}

/** Replace the paused-agent set from the latest session heartbeat. Only
 * parent sessions count — a paused subagent doesn't make the agent paused. */
export function updatePausedAgents(userIds: number[]): void {
  const next = new Set(userIds);
  if (
    next.size === pausedAgentIds.size &&
    [...next].every((id) => pausedAgentIds.has(id))
  ) {
    return;
  }
  pausedAgentIds.clear();
  for (const id of next) pausedAgentIds.add(id);
  broadcastAgentStatus(getAgentSnapshot());
}

export function updateActiveSubagentCount(
  userId: number,
  runId: number,
  count: number,
): void {
  const key = parentRunKey(userId, runId);
  if (count > 0) {
    activeSubagentCounts.set(key, { userId, runId, count });
  } else {
    activeSubagentCounts.delete(key);
  }
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
  for (const state of hostStates.values()) {
    if (state.online && !state.restricted && state.hostType === "naisys")
      return true;
  }
  return false;
}

export function getAgentStatus(agentId: number): AgentStatus {
  return determineAgentStatus({
    isActive: activeAgentIds.has(agentId),
    isPaused: pausedAgentIds.has(agentId),
    isEnabled: !disabledAgentIds.has(agentId),
    isSuspended: costSuspendedAgentIds.has(agentId),
    assignedHostIds: agentHostAssignments.get(agentId),
    isHostOnline: (hid) => connectedHostIds.has(hid),
    hasNonRestrictedOnlineHost: hasNonRestrictedOnlineHost(),
  });
}

export function getActiveSubagentCount(userId: number, runId: number): number {
  return activeSubagentCounts.get(parentRunKey(userId, runId))?.count ?? 0;
}

export function isHostConnected(hostId: number): boolean {
  return connectedHostIds.has(hostId);
}

export function getHostVersion(hostId: number): string {
  return hostStates.get(hostId)?.version ?? "";
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
  for (const [hostId, state] of hostStates) {
    hosts[String(hostId)] = { online: state.online, version: state.version };
  }
  return { hosts };
}

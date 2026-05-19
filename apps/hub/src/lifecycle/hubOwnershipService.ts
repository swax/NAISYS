import { addToSetMap, deleteFromSetMap } from "@naisys/common";
import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import type { AgentsStatus } from "@naisys/hub-protocol";
import { HUB_HEARTBEAT_INTERVAL_MS, HubEvents } from "@naisys/hub-protocol";

import type { NaisysServer } from "../server/naisysServer.js";

/**
 * Host-to-user ACL with two views on the same map:
 *
 * - `hostOwnsUser` reads the durable map — entries persist across socket
 *   disconnect and are released only on AGENT_STOP, so buffered log/cost
 *   writes flushed on reconnect aren't dropped.
 * - `getActiveUserIds`, `findHostsForAgent`, `getHostActiveAgentCount`, and
 *   the AGENTS_STATUS broadcast intersect the ACL with currently-connected
 *   hosts so callers don't see disconnected hosts as "running."
 */
export function createHubOwnershipService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  /** Admin is a per-instance debug surface that skips AGENT_START and has no
   *  runtime key — exempt from the ACL gate. */
  adminUserId: number,
) {
  // Subagents ride under the parent's userId.
  const hostActiveAgents = new Map<number, Set<number>>();

  const agentNotifications = new Map<
    number,
    { latestLogId: number; latestMailId: number; latestChatId: number }
  >();

  function updateAgentNotification(
    userId: number,
    field: "latestLogId" | "latestMailId" | "latestChatId",
    value: number,
  ) {
    let entry = agentNotifications.get(userId);
    if (!entry) {
      entry = { latestLogId: 0, latestMailId: 0, latestChatId: 0 };
      agentNotifications.set(userId, entry);
    }
    entry[field] = value;
  }

  function getConnectedHostIds(): Set<number> {
    return new Set(
      naisysServer.getConnectedClients().map((c) => c.getHostId()),
    );
  }

  // Buffered log/cost writes flush on socket connect before the first
  // heartbeat, so the ACL must be in place before sockets are accepted.
  // Source of truth: users with a live api_key_hash plus their most-recent
  // run_session host. Bounded to recent activity — heartbeats are 2s apart,
  // so anything older than the window is residual from a crashed agent that
  // never sent AGENT_STOP, not a real running session.
  const PRELOAD_WINDOW_MS = 5 * 60_000;
  void (async () => {
    try {
      const cutoff = new Date(Date.now() - PRELOAD_WINDOW_MS);
      const users = await hubDb.users.findMany({
        where: {
          api_key_hash: { not: null },
          enabled: true,
          archived: false,
        },
        select: { id: true },
      });
      for (const user of users) {
        if (user.id === adminUserId) continue;
        const latest = await hubDb.run_session.findFirst({
          where: { user_id: user.id, last_active: { gte: cutoff } },
          orderBy: { last_active: "desc" },
          select: { host_id: true },
        });
        if (!latest) continue;
        addStartedAgent(latest.host_id, user.id);
      }
    } catch (err) {
      logService.error(`[Hub:Ownership] Ownership preload failed: ${err}`);
    }
  })();

  // Disconnect deliberately does NOT clear the ACL: a host's authority
  // persists so its buffered writes on reconnect pass the gate. Released
  // only by AGENT_STOP.
  naisysServer.registerEvent(HubEvents.CLIENT_CONNECTED, () => {
    throttledPushAgentsStatus();
  });
  naisysServer.registerEvent(HubEvents.CLIENT_DISCONNECTED, () => {
    throttledPushAgentsStatus();
  });

  function buildLiveHostActiveAgents(): Map<number, number[]> {
    const connected = getConnectedHostIds();
    const filtered = new Map<number, number[]>();
    for (const [hostId, userIds] of hostActiveAgents) {
      if (connected.has(hostId)) filtered.set(hostId, [...userIds]);
    }
    return filtered;
  }

  let lastPushedJson = "";

  function pushAgentsStatus() {
    const payload: AgentsStatus = {
      hostActiveAgents: Object.fromEntries(buildLiveHostActiveAgents()),
      agentNotifications: Object.fromEntries(agentNotifications),
    };

    const json = JSON.stringify(payload);
    if (json === lastPushedJson) return;
    lastPushedJson = json;

    naisysServer.broadcastToAll(HubEvents.AGENTS_STATUS, payload);
  }

  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  function throttledPushAgentsStatus() {
    if (throttleTimer) return;
    pushAgentsStatus();
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
    }, 500);
  }

  // Baseline push for any change the throttle window swallowed.
  const pushInterval = setInterval(pushAgentsStatus, HUB_HEARTBEAT_INTERVAL_MS);

  function getHostActiveAgentCount(hostId: number): number {
    if (!getConnectedHostIds().has(hostId)) return 0;
    return hostActiveAgents.get(hostId)?.size ?? 0;
  }

  function findHostsForAgent(userId: number): number[] {
    const connected = getConnectedHostIds();
    const hostIds: number[] = [];
    for (const [hostId, userIds] of hostActiveAgents) {
      if (connected.has(hostId) && userIds.has(userId)) hostIds.push(hostId);
    }
    return hostIds;
  }

  function hostOwnsUser(hostId: number, userId: number): boolean {
    if (userId === adminUserId) return true;
    return hostActiveAgents.get(hostId)?.has(userId) ?? false;
  }

  function addStartedAgent(hostId: number, userId: number) {
    addToSetMap(hostActiveAgents, hostId, userId);
    throttledPushAgentsStatus();
  }

  function removeStoppedAgent(hostId: number, userId: number) {
    deleteFromSetMap(hostActiveAgents, hostId, userId);
    throttledPushAgentsStatus();
  }

  /** Sync this host's ACL with the userIds it claims to be running. Admin
   *  is added here (it skips AGENT_START so heartbeat is the only signal);
   *  any ACL entry the host no longer claims is removed (natural completion
   *  of a top-level agent — runner doesn't AGENT_STOP for that). Non-admin
   *  additions still come from verified runtime-key claims in the heartbeat
   *  handler. */
  function reconcileHeartbeatPresence(
    hostId: number,
    claimedUserIds: Set<number>,
  ) {
    if (claimedUserIds.has(adminUserId)) {
      addStartedAgent(hostId, adminUserId);
    }

    const current = hostActiveAgents.get(hostId);
    if (current) {
      for (const userId of current) {
        if (!claimedUserIds.has(userId)) {
          removeStoppedAgent(hostId, userId);
        }
      }
    }
  }

  function getActiveUserIds(): Set<number> {
    const connected = getConnectedHostIds();
    const allActiveUserIds = new Set<number>();
    for (const [hostId, userIds] of hostActiveAgents) {
      if (!connected.has(hostId)) continue;
      for (const id of userIds) allActiveUserIds.add(id);
    }
    return allActiveUserIds;
  }

  function cleanup() {
    clearInterval(pushInterval);
  }

  return {
    cleanup,
    adminUserId,
    hostOwnsUser,
    addStartedAgent,
    removeStoppedAgent,
    reconcileHeartbeatPresence,
    findHostsForAgent,
    getHostActiveAgentCount,
    getActiveUserIds,
    updateAgentNotification,
    throttledPushAgentsStatus,
  };
}

export type HubOwnershipService = ReturnType<typeof createHubOwnershipService>;

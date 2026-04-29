import type { UserEntry } from "@naisys/common";
import { ADMIN_USERNAME, determineAgentStatus } from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common-node";
import type { UserListResponse } from "@naisys/hub-protocol";
import { HubEvents, UserListResponseSchema } from "@naisys/hub-protocol";

import type { HubClient } from "../hub/hubClient.js";
import type { HostService } from "../services/hostService.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";

export type { UserEntry };

/** Loads agent configs from yaml files or receives them pushed from the hub */
export function createUserService(
  hubClient: HubClient | undefined,
  promptNotificationService: PromptNotificationService,
  hostService: HostService,
  startupAgentPath?: string,
) {
  let userMap: Map<number, UserEntry>;

  let usersReadyPromise: Promise<void>;

  init();

  function init() {
    if (hubClient) {
      // Register handler for pushed user list from hub
      let resolveUsers: () => void;
      let rejectUsers: (error: Error) => void;

      usersReadyPromise = new Promise<void>((resolve, reject) => {
        resolveUsers = resolve;
        rejectUsers = reject;
      });

      hubClient.registerEvent(HubEvents.USERS_UPDATED, (data) => {
        try {
          const response = UserListResponseSchema.parse(data);
          if (!response.success) {
            rejectUsers(
              new Error(response.error || "Failed to get user list from hub"),
            );
            return;
          }

          const newMap = parseUserList(response);
          // The hub doesn't know about ephemerals, so carry them forward.
          if (userMap) {
            for (const user of userMap.values()) {
              if (user.isEphemeral) newMap.set(user.userId, user);
            }
          }
          userMap = newMap;
          resolveUsers();
        } catch (error) {
          rejectUsers(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    } else {
      userMap = loadAgentConfigs(startupAgentPath || "");
      usersReadyPromise = Promise.resolve();
    }
  }

  /** Wait for the user list to be received (resolves immediately in standalone mode) */
  function waitForUsers(): Promise<void> {
    return usersReadyPromise;
  }

  function getUsers(): UserEntry[] {
    return Array.from(userMap.values());
  }

  /** Like getUsers, but hides ephemerals from anyone other than their parent.
   * Use for any per-agent display so siblings can't see each other's subagents. */
  function getVisibleUsers(perspectiveUserId: number): UserEntry[] {
    return Array.from(userMap.values()).filter((u) => {
      if (!u.isEphemeral) return true;
      return (
        u.leadUserId === perspectiveUserId || u.userId === perspectiveUserId
      );
    });
  }

  function getUserById(id: number): UserEntry | undefined {
    return userMap.get(id);
  }

  /** In hub mode, we just start the admin user, otherwise we start all lead agents */
  function getStartupUserIds(): number[] {
    const adminUser = getUserByName(ADMIN_USERNAME);
    const adminId = adminUser?.userId ?? 0;

    const notify = (userId: number, message: string) => {
      promptNotificationService.notify({
        wake: "always",
        userId,
        commentOutput: [message],
      });
    };

    if (hubClient) {
      notify(
        adminId,
        `No agents running yet. Supervisor/Hub will start agents on demand. The admin shell can be used for diagnostics.`,
      );
      return [adminId];
    }

    const leadAgents = Array.from(userMap.values()).filter(
      (u) => !u.leadUserId && u.userId !== adminId,
    );

    if (leadAgents.length === 0) {
      notify(
        adminId,
        `No agent param include at startup so you are in the admin shell which can be used for diagnostics.`,
      );
      return [adminId];
    }

    // In standalone mode with a single agent, don't start admin as it would
    // require the user to exit twice and prevent ns-session complete from ending the app
    if (leadAgents.length === 1) {
      return [leadAgents[0].userId];
    }

    // Multiple agents: always include admin so that all agents can be turned off without ending process
    const agentList = leadAgents.map((u) => u.username).join(", ");
    leadAgents.forEach((agent) =>
      notify(agent.userId, `Multiple agents started: ${agentList}`),
    );

    return [...leadAgents.map((u) => u.userId), adminId];
  }

  // Active user tracking (driven by heartbeatService)
  let activeUserIds = new Set<number>();
  let userHostIds = new Map<number, number[]>();

  function setActiveUsers(hostActiveAgents: Record<string, number[]>) {
    const newActiveUserIds = new Set<number>();
    const newUserHostIds = new Map<number, number[]>();

    for (const [hostIdStr, userIds] of Object.entries(hostActiveAgents)) {
      const hostId = Number(hostIdStr);
      for (const userId of userIds) {
        newActiveUserIds.add(userId);
        if (hostIdStr) {
          const existing = newUserHostIds.get(userId);
          if (existing) {
            existing.push(hostId);
          } else {
            newUserHostIds.set(userId, [hostId]);
          }
        }
      }
    }

    activeUserIds = newActiveUserIds;
    userHostIds = newUserHostIds;
  }

  function isUserActive(userId: number): boolean {
    return activeUserIds.has(userId);
  }

  function getUserHostIds(userId: number): number[] {
    return userHostIds.get(userId) ?? [];
  }

  function getUserHostNames(userId: number): string[] {
    const hostIds = userHostIds.get(userId) ?? [];
    return hostIds
      .map((id) => hostService.getHostName(id))
      .filter((name): name is string => !!name);
  }

  function getUserHostDisplayNames(userId: number): string[] {
    const hostIds = userHostIds.get(userId) ?? [];
    const localHostId = hostService.getLocalHostId();
    return hostIds
      .map((id) =>
        id === localHostId ? "(local)" : hostService.getHostName(id),
      )
      .filter((name): name is string => !!name);
  }

  function getUserStatus(
    userId: number,
  ): "Active" | "Available" | "Disabled" | "Offline" {
    if (!hubClient) return "Available";

    const user = userMap.get(userId);
    const status = determineAgentStatus({
      isActive: isUserActive(userId),
      isEnabled: user?.enabled ?? true,
      isSuspended: false,
      assignedHostIds: user?.assignedHostIds,
      isHostOnline: hostService.isHostActive,
      hasNonRestrictedOnlineHost: hostService.hasNonRestrictedOnlineHost(),
    });

    return (status.charAt(0).toUpperCase() + status.slice(1)) as
      | "Active"
      | "Available"
      | "Disabled"
      | "Offline";
  }

  /** Parse a UserListResponse into a userId → UserEntry map */
  function parseUserList(response: UserListResponse): Map<number, UserEntry> {
    const map = new Map<number, UserEntry>();
    for (const user of response.users ?? []) {
      map.set(user.userId, {
        userId: user.userId,
        username: user.username,
        enabled: user.enabled,
        leadUserId: user.leadUserId,
        assignedHostIds: user.assignedHostIds,
        config: user.config,
      });
    }
    return map;
  }

  function getUserByName(username: string): UserEntry | undefined {
    for (const user of userMap.values()) {
      if (user.username === username) {
        return user;
      }
    }
    return undefined;
  }

  /** Synthetic id for an ephemeral subagent. Negative values can't collide
   * with hub-assigned positive ids, and double as the entry's `subagentId`. */
  let nextSyntheticId = 0;
  function nextSyntheticUserId(): number {
    nextSyntheticId -= 1;
    return nextSyntheticId;
  }

  /** Add an ephemeral user that lives only in local memory; never sent to the hub. */
  function addLocalUser(entry: UserEntry): void {
    if (userMap.has(entry.userId)) {
      throw `User id ${entry.userId} already exists`;
    }
    userMap.set(entry.userId, entry);
  }

  function removeLocalUser(userId: number): void {
    userMap.delete(userId);
  }

  /** Parse a comma-separated username string and resolve to users. Throws on any not-found. */
  function resolveUsernames(csvUsernames: string): UserEntry[] {
    const usernames = csvUsernames.split(",").map((u) => u.trim());
    const resolved: UserEntry[] = [];
    const errors: string[] = [];

    for (const username of usernames) {
      const user = getUserByName(username);
      if (!user) {
        errors.push(`'${username}' not found`);
      } else {
        resolved.push(user);
      }
    }

    if (errors.length > 0) {
      throw `Error: ${errors.join("; ")}`;
    }

    return resolved;
  }

  return {
    getUsers,
    getVisibleUsers,
    getUserById,
    waitForUsers,
    getStartupUserIds,
    setActiveUsers,
    isUserActive,
    getUserHostIds,
    getUserHostNames,
    getUserHostDisplayNames,
    getUserStatus,
    getUserByName,
    resolveUsernames,
    nextSyntheticUserId,
    addLocalUser,
    removeLocalUser,
  };
}

export type UserService = ReturnType<typeof createUserService>;

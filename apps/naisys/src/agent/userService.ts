import { AgentConfigFileSchema, UserEntry } from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common/dist/agentConfigLoader.js";
import {
  HubEvents,
  UserListResponse,
  UserListResponseSchema,
} from "@naisys/hub-protocol";
import yaml from "js-yaml";
import { HubClient } from "../hub/hubClient.js";
import { HostService } from "../services/hostService.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";

export { UserEntry };

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

      hubClient.registerEvent(HubEvents.USER_LIST, (data: unknown) => {
        try {
          const response = UserListResponseSchema.parse(data);
          if (!response.success) {
            rejectUsers(
              new Error(response.error || "Failed to get user list from hub"),
            );
            return;
          }

          userMap = parseUserList(response);
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

  function getUserById(id: number): UserEntry | undefined {
    return userMap.get(id);
  }

  /** In non integrated hub mode, we just start the debug user, otherwise we start all lead agents */
  function getStartupUserIds(integratedHub: boolean): number[] {
    const adminUser = getUserByName("admin");
    const adminId = adminUser?.userId ?? 0;

    const notify = (userId: number, message: string) => {
      promptNotificationService.notify({
        wake: true,
        userId,
        commentOutput: [message],
      });
    };

    if (hubClient && !integratedHub) {
      notify(
        adminId,
        `No agents running yet. Hub will start agents on demand.`,
      );
      return [adminId];
    }

    const leadAgents = Array.from(userMap.values()).filter(
      (u) => !u.leadUserId && u.userId !== adminId,
    );

    if (leadAgents.length === 0) {
      notify(adminId, `No agents found to start`);
      return [adminId];
    }

    // In standalone mode with a single agent, don't start admin as it would
    // require the user to exit twice and prevent ns-session complete from ending the app
    if (leadAgents.length === 1 && !integratedHub) {
      return [leadAgents[0].userId];
    }

    // Integrated hub mode or multiple agents: always include admin so that all agents can be turned off without ending process
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

  function getUserStatus(userId: number): "Active" | "Available" | "Offline" {
    if (isUserActive(userId)) return "Active";
    if (!hubClient) return "Available";

    const user = userMap.get(userId);
    if (!user?.assignedHostIds || user.assignedHostIds.length === 0)
      return "Available";

    for (const hostId of user.assignedHostIds) {
      if (hostService.isHostActive(hostId)) return "Available";
    }

    return "Offline";
  }

  /** Parse a UserListResponse into a userId → UserEntry map */
  function parseUserList(response: UserListResponse): Map<number, UserEntry> {
    const map = new Map<number, UserEntry>();
    for (const user of response.users ?? []) {
      const configObj = yaml.load(user.configYaml);
      const config = AgentConfigFileSchema.parse(configObj);

      map.set(user.userId, {
        userId: user.userId,
        username: user.username,
        configId: "",
        leadUserId: user.leadUserId,
        assignedHostIds: user.assignedHostIds,
        apiKey: user.apiKey,
        config,
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

  return {
    getUsers,
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
  };
}

export type UserService = ReturnType<typeof createUserService>;

import {
  AgentConfigFileSchema,
  UserEntry,
  debugAgentConfig,
  debugUserId,
} from "@naisys/common";
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
  let userMap: Map<string, UserEntry>;

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

  function addDebugUser() {
    userMap.set(debugAgentConfig._id, {
      username: debugAgentConfig.username,
      userId: debugAgentConfig._id,
      config: debugAgentConfig,
    });
  }

  /** Wait for the user list to be received (resolves immediately in standalone mode) */
  function waitForUsers(): Promise<void> {
    return usersReadyPromise;
  }

  function getUsers(): UserEntry[] {
    return Array.from(userMap.values());
  }

  function getUserById(id: string): UserEntry | undefined {
    return userMap.get(id);
  }

  /** In non integrated hub mode, we just start the debug user, otherwise we start all lead agents */
  function getStartupUserIds(integratedHub: boolean): string[] {
    if (hubClient && !integratedHub) {
      promptNotificationService.notify({
        wake: true,
        userId: debugUserId,
        commentOutput: [`No agents running. Hub will start agents on demand.`],
      });
      addDebugUser();
      return [debugUserId];
    }

    const leadAgents = Array.from(userMap.values()).filter(
      (u) => !u.leadUserId,
    );

    if (leadAgents.length === 0) {
      throw new Error("No lead agents found to start");
    }

    if (leadAgents.length > 0) {
      promptNotificationService.notify({
        wake: true,
        commentOutput: [
          `Starting lead agents: ${leadAgents.map((u) => u.username).join(", ")}`,
        ],
      });
    }

    return leadAgents.map((u) => u.userId);
  }

  // Active user tracking (driven by heartbeatService)
  let activeUserIds = new Set<string>();
  let userHostIds = new Map<string, string[]>();

  function setActiveUsers(hostActiveAgents: Record<string, string[]>) {
    const newActiveUserIds = new Set<string>();
    const newUserHostIds = new Map<string, string[]>();

    for (const [hostId, userIds] of Object.entries(hostActiveAgents)) {
      for (const userId of userIds) {
        newActiveUserIds.add(userId);
        if (hostId) {
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

  function isUserActive(userId: string): boolean {
    return activeUserIds.has(userId);
  }

  function getUserHostIds(userId: string): string[] {
    return userHostIds.get(userId) ?? [];
  }

  function getUserHostNames(userId: string): string[] {
    const hostIds = userHostIds.get(userId) ?? [];
    return hostIds
      .map((id) => hostService.getHostName(id))
      .filter((name): name is string => !!name);
  }

  /** Parse a UserListResponse into a userId → UserEntry map */
  function parseUserList(response: UserListResponse): Map<string, UserEntry> {
    const map = new Map<string, UserEntry>();
    for (const user of response.users ?? []) {
      const configObj = yaml.load(user.configYaml);
      const config = AgentConfigFileSchema.parse(configObj);

      map.set(user.userId, {
        userId: user.userId,
        username: user.username,
        leadUserId: user.leadUserId,
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
    getUserByName,
  };
}

export type UserService = ReturnType<typeof createUserService>;

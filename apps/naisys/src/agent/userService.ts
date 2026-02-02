import {
  AgentConfigFileSchema,
  UserEntry,
  debugAgentConfig,
} from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common/dist/agentConfigLoader.js";
import {
  HubEvents,
  UserListResponse,
  UserListResponseSchema,
} from "@naisys/hub-protocol";
import yaml from "js-yaml";
import * as path from "path";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

export { UserEntry };

/** Loads agent configs from yaml files or receives them pushed from the hub */
export function createUserService(
  { globalConfig }: GlobalConfig,
  hubClient: HubClient,
  startupAgentPath?: string,
) {
  const isHubMode = globalConfig().isHubMode;

  let userMap: Map<string, UserEntry>;

  let usersReadyPromise: Promise<void>;

  init();

  function init() {
    if (isHubMode) {
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
          addDebugUser();
          resolveUsers();
        } catch (error) {
          rejectUsers(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    } else {
      const naisysFolder = globalConfig().naisysFolder;
      if (!naisysFolder) {
        throw new Error("naisysFolder is not configured in globalConfig");
      }
      userMap = loadAgentConfigs(startupAgentPath || "");
      addDebugUser();
      usersReadyPromise = Promise.resolve();
    }
  }

  function addDebugUser() {
    userMap.set(debugAgentConfig.username, {
      userId: "0",
      config: debugAgentConfig,
      agentPath: "",
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

  function getStartupUserId(agentPath?: string): string {
    if (agentPath) {
      const absolutePath = path.resolve(agentPath);
      for (const [userId, entry] of userMap) {
        if (entry.agentPath === absolutePath) {
          return userId;
        }
      }
      throw new Error(`No user found for agent path: ${absolutePath}`);
    }

    if (!userMap.has(debugAgentConfig.username)) {
      throw new Error("Debug user not found");
    }
    return debugAgentConfig.username;
  }

  // Active user tracking (driven by heartbeatService)
  let activeUserIds = new Set<string>();

  function setActiveUserIds(ids: string[]) {
    activeUserIds = new Set(ids);
  }

  function isUserActive(userId: string): boolean {
    return activeUserIds.has(userId);
  }

  /** Parse a UserListResponse into a userId → UserEntry map */
  function parseUserList(response: UserListResponse): Map<string, UserEntry> {
    const map = new Map<string, UserEntry>();
    for (const user of response.users ?? []) {
      const configObj = yaml.load(user.configYaml);
      const config = AgentConfigFileSchema.parse(configObj);

      map.set(user.userId, {
        userId: user.userId,
        leadUserId: user.leadUserId,
        config,
        agentPath: user.agentPath,
      });
    }
    return map;
  }

  function getUserByName(username: string): UserEntry | undefined {
    for (const user of userMap.values()) {
      if (user.config.username === username) {
        return user;
      }
    }
    return undefined;
  }

  return {
    getUsers,
    getUserById,
    waitForUsers,
    getStartupUserId,
    setActiveUserIds,
    isUserActive,
    getUserByName,
  };
}

export type UserService = ReturnType<typeof createUserService>;

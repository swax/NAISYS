import {
  AgentConfigFileSchema,
  UserEntry,
  defaultAdminConfig,
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

  let users: Map<string, UserEntry>;

  let usersReadyPromise: Promise<void>;

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

        users = parseUserList(response);
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
    users = loadAgentConfigs(naisysFolder, startupAgentPath);
    usersReadyPromise = Promise.resolve();
  }

  /** Wait for the user list to be received (resolves immediately in standalone mode) */
  function waitForUsers(): Promise<void> {
    return usersReadyPromise;
  }

  function getUsers(): Map<string, UserEntry> {
    return users;
  }

  function getUserById(id: string): UserEntry | undefined {
    return users.get(id);
  }

  function getStartupUserId(agentPath?: string): string {
    if (agentPath) {
      const absolutePath = path.resolve(agentPath);
      for (const [username, entry] of users) {
        if (entry.agentPath === absolutePath) {
          return username;
        }
      }
      throw new Error(`No user found for agent path: ${absolutePath}`);
    }

    if (!users.has("admin")) {
      throw new Error("Admin user not found");
    }
    return "admin";
  }

  // Active user tracking (driven by heartbeatService)
  let activeUserIds = new Set<string>();

  function setActiveUserIds(ids: string[]) {
    activeUserIds = new Set(ids);
  }

  function isUserActive(userId: string): boolean {
    return activeUserIds.has(userId);
  }

  return {
    getUsers,
    getUserById,
    waitForUsers,
    getStartupUserId,
    setActiveUserIds,
    isUserActive,
  };
}

export type UserService = ReturnType<typeof createUserService>;

/** Parse a UserListResponse into a UserEntry map */
function parseUserList(response: UserListResponse): Map<string, UserEntry> {
  const users = new Map<string, UserEntry>();

  for (const user of response.users ?? []) {
    const configObj = yaml.load(user.configYaml);
    const config = AgentConfigFileSchema.parse(configObj);
    users.set(config.username, {
      config,
      agentPath: user.agentPath,
      configYaml: user.configYaml,
    });
  }

  // Ensure admin user is always present
  if (!users.has("admin")) {
    users.set("admin", {
      config: defaultAdminConfig,
      agentPath: "",
      configYaml: yaml.dump(defaultAdminConfig),
    });
  }

  return users;
}

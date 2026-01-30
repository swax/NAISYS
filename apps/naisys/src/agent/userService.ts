import {
  AgentConfigFileSchema,
  UserEntry,
  defaultAdminConfig,
} from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common/dist/agentConfigLoader.js";
import { HubEvents, UserListResponse } from "@naisys/hub-protocol";
import yaml from "js-yaml";
import * as path from "path";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

export { UserEntry };

/** Loads agent configs from yaml files or requests them from the hub */
export async function createUserService(
  { globalConfig }: GlobalConfig,
  hubClient: HubClient,
  startupAgentPath?: string,
) {
  const isHubMode = globalConfig().isHubMode;

  let users: Map<string, UserEntry>;

  if (isHubMode) {
    users = await requestUsersFromHub(hubClient);
  } else {
    const naisysFolder = globalConfig().naisysFolder;
    if (!naisysFolder) {
      throw new Error("naisysFolder is not configured in globalConfig");
    }
    users = loadAgentConfigs(naisysFolder, startupAgentPath);
  }

  async function reloadAgents() {
    if (isHubMode) {
      users = await requestUsersFromHub(hubClient);
      return;
    }
    const naisysFolder = globalConfig().naisysFolder;
    if (!naisysFolder) {
      throw new Error("naisysFolder is not configured in globalConfig");
    }
    users = loadAgentConfigs(naisysFolder, startupAgentPath);
  }

  function getUsers(): Map<string, UserEntry> {
    return users;
  }

  function getStartupUsername(agentPath?: string): string {
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

  return {
    getUsers,
    reloadAgents,
    getStartupUsername,
  };
}

export type UserService = Awaited<ReturnType<typeof createUserService>>;

/** Request the user list from the hub and parse configs into UserEntry map */
async function requestUsersFromHub(
  hubClient: HubClient,
): Promise<Map<string, UserEntry>> {
  const response = await hubClient.sendRequest<UserListResponse>(
    HubEvents.USER_LIST,
    {},
  );

  if (!response.success) {
    throw new Error(response.error || "Failed to get user list from hub");
  }

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

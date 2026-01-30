import { UserEntry } from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common/dist/agentConfigLoader.js";
import * as path from "path";
import { GlobalConfig } from "../globalConfig.js";

export { UserEntry };

/** Loads agent configs from yaml files into an in-memory map of users by name */
export function createUserService(
  { globalConfig }: GlobalConfig,
  startupAgentPath?: string,
) {
  const naisysFolder = globalConfig().naisysFolder;
  if (!naisysFolder) {
    throw new Error("naisysFolder is not configured in globalConfig");
  }

  let users = loadAgentConfigs(naisysFolder, startupAgentPath);

  function reloadAgents() {
    users = loadAgentConfigs(naisysFolder, startupAgentPath);
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
    users,
    reloadAgents,
    getStartupUsername,
  };
}

export type UserService = Awaited<ReturnType<typeof createUserService>>;

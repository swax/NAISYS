import { UserEntry } from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common/dist/agentConfigLoader.js";
import { DatabaseService } from "@naisys/database";
import { HubConfig } from "../hubConfig.js";
import yaml from "js-yaml";

/** Loads agent configs from yaml files, then syncs them to the database */
export async function createAgentRegistrar(
  hubConfig: HubConfig,
  dbService: DatabaseService,
  startupAgentPath?: string,
) {
  await reloadAgents();

  async function reloadAgents() {
    const users = loadAgentConfigs(startupAgentPath || "");

    await syncUsersToDatabase(users);
  }

  async function syncUsersToDatabase(users: Map<string, UserEntry>) {
    for (const user of users.values()) {
      await dbService.usingDatabase(async (prisma) => {
        await prisma.users.upsert({
          where: { id: user.userId },
          create: {
            id: user.userId,
            username: user.config.username,
            title: user.config.title,
            agent_path: user.agentPath,
            lead_user_id: user.leadUserId,
            config: yaml.dump(user.config),
          },
          update: {
            title: user.config.title,
            agent_path: user.agentPath,
            lead_user_id: user.leadUserId,
            config: yaml.dump(user.config),
          },
        });

        await prisma.user_notifications.upsert({
          where: { user_id: user.userId },
          create: {
            user_id: user.userId,
          },
          update: {},
        });
      });
    }
  }

  return {
    reloadAgents,
  };
}

export type AgentRegistrar = Awaited<ReturnType<typeof createAgentRegistrar>>;

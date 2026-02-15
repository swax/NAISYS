import { UserEntry } from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common/dist/agentConfigLoader.js";
import { DatabaseService } from "@naisys/database";
import { randomBytes } from "crypto";
import yaml from "js-yaml";
import { HubConfig } from "../hubConfig.js";

/** Loads agent configs from yaml files, then syncs them to the database */
export async function createAgentRegistrar(
  dbService: DatabaseService,
  startupAgentPath?: string,
) {
  await reloadAgents();

  async function reloadAgents() {
    const users = loadAgentConfigs(startupAgentPath || "");

    await syncUsersToDatabase(users);
  }

  async function syncUsersToDatabase(users: Map<number, UserEntry>) {
    // First pass: upsert all users by uuid, build configId → dbId map
    const configIdToDbId = new Map<string, number>();

    for (const user of users.values()) {
      await dbService.usingDatabase(async (prisma) => {
        const dbUser = await prisma.users.upsert({
          where: { uuid: user.configId },
          create: {
            uuid: user.configId,
            username: user.username,
            title: user.config.title,
            agent_path: user.agentPath ?? null,
            config: yaml.dump(user.config),
            api_key: randomBytes(32).toString("hex"),
          },
          update: {
            title: user.config.title,
            agent_path: user.agentPath ?? null,
            config: yaml.dump(user.config),
          },
        });

        configIdToDbId.set(user.configId, dbUser.id);

        await prisma.user_notifications.upsert({
          where: { user_id: dbUser.id },
          create: {
            user_id: dbUser.id,
          },
          update: {},
        });
      });
    }

    // Second pass: update lead_user_id relationships
    for (const user of users.values()) {
      if (user.leadUserId !== undefined) {
        // Find the lead user's configId from the user map
        const leadUser = users.get(user.leadUserId);
        if (leadUser) {
          const dbId = configIdToDbId.get(user.configId);
          const leadDbId = configIdToDbId.get(leadUser.configId);
          if (dbId !== undefined && leadDbId !== undefined) {
            await dbService.usingDatabase(async (prisma) => {
              await prisma.users.update({
                where: { id: dbId },
                data: { lead_user_id: leadDbId },
              });
            });
          }
        }
      }
    }
  }

  return {
    reloadAgents,
  };
}

export type AgentRegistrar = Awaited<ReturnType<typeof createAgentRegistrar>>;

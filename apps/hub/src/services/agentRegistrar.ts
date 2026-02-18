import { UserEntry } from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common/dist/agentConfigLoader.js";
import { DatabaseService } from "@naisys/database";
import { randomBytes, randomUUID } from "crypto";
import yaml from "js-yaml";
import { HubServerLog } from "./hubServerLog";

/** Seeds agent configs from YAML files into an empty database. Skips if users already exist. */
export async function seedAgentConfigs(
  dbService: DatabaseService,
  logService: HubServerLog,
  startupAgentPath?: string,
) {
  // Check if users table already has rows (seed-once pattern)
  const hasUsers = await dbService.usingDatabase(async (prisma) => {
    const count = await prisma.users.count();
    return count > 0;
  });

  if (hasUsers) {
    logService.log("[Hub:AgentRegistrar] Agents already seeded");
    return;
  }

  // Default to CWD when no path specified (matches standalone hub behavior)
  const users = loadAgentConfigs(startupAgentPath || "");
  await seedUsersToDatabase(dbService, logService, users);
}

async function seedUsersToDatabase(
  dbService: DatabaseService,
  logService: HubServerLog,
  users: Map<number, UserEntry>,
) {
  // First pass: create all users, build loader userId → DB id map
  const loaderIdToDbId = new Map<number, number>();

  for (const user of users.values()) {
    await dbService.usingDatabase(async (prisma) => {
      const dbUser = await prisma.users.create({
        data: {
          uuid: randomUUID(),
          username: user.username,
          title: user.config.title,
          config: yaml.dump(user.config),
          api_key: randomBytes(32).toString("hex"),
        },
      });

      loaderIdToDbId.set(user.userId, dbUser.id);

      await prisma.user_notifications.create({
        data: {
          user_id: dbUser.id,
        },
      });
    });
  }

  // Second pass: update lead_user_id relationships
  for (const user of users.values()) {
    if (user.leadUserId !== undefined) {
      const dbId = loaderIdToDbId.get(user.userId);
      const leadDbId = loaderIdToDbId.get(user.leadUserId);
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

  logService.log(
    `[Hub:AgentRegistrar] Seeded ${users.size} users into database`,
  );
}

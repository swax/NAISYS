import type { UserEntry } from "@naisys/common";
import { adminAgentConfig, toUrlSafeKey } from "@naisys/common";
import { loadAgentConfigs } from "@naisys/common-node";
import {
  type HubDatabaseService,
  type PrismaClient,
} from "@naisys/hub-database";
import { randomBytes, randomUUID } from "crypto";

import type { DualLogger } from "@naisys/common-node";

/** Seeds agent configs from YAML files into an empty database. Skips if users already exist. */
export async function seedAgentConfigs(
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  startupAgentPath?: string,
) {
  // Check if users table already has rows (seed-once pattern)
  const count = await hubDb.users.count();
  const hasUsers = count > 0;

  if (hasUsers) {
    logService.log("[Hub:AgentRegistrar] Agents already seeded");
    return;
  }

  if (startupAgentPath) {
    const users = loadAgentConfigs(startupAgentPath);
    await seedUsersToDatabase(hubDb, logService, users);
  } else {
    // No seed path: just create the admin agent
    const adminUsers = new Map<number, UserEntry>();
    adminUsers.set(1, {
      userId: 1,
      username: adminAgentConfig.username,
      enabled: true,
      leadUserId: undefined,
      config: adminAgentConfig,
    });
    await seedUsersToDatabase(hubDb, logService, adminUsers);
  }
}

async function seedUsersToDatabase(
  hubDb: PrismaClient,
  logService: DualLogger,
  users: Map<number, UserEntry>,
) {
  // First pass: create all users, build loader userId → DB id map
  const loaderIdToDbId = new Map<number, number>();

  for (const user of users.values()) {
    const safeUsername = toUrlSafeKey(user.username);

    const dbUser = await hubDb.users.create({
      data: {
        uuid: randomUUID(),
        username: safeUsername,
        title: user.config.title,
        config: JSON.stringify({ ...user.config, username: safeUsername }),
        api_key: randomBytes(32).toString("hex"),
      },
    });

    loaderIdToDbId.set(user.userId, dbUser.id);

    await hubDb.user_notifications.create({
      data: {
        user_id: dbUser.id,
      },
    });
  }

  // Second pass: update lead_user_id relationships
  for (const user of users.values()) {
    if (user.leadUserId !== undefined) {
      const dbId = loaderIdToDbId.get(user.userId);
      const leadDbId = loaderIdToDbId.get(user.leadUserId);
      if (dbId !== undefined && leadDbId !== undefined) {
        await hubDb.users.update({
          where: { id: dbId },
          data: { lead_user_id: leadDbId },
        });
      }
    }
  }

  logService.log(
    `[Hub:AgentRegistrar] Seeded ${users.size} users into database`,
  );
}

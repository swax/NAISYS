import { loadAgentConfigs, UserEntry } from "@naisys/common";
import { DatabaseService, ulid } from "@naisys/database";
import { HubConfig } from "../hubConfig.js";
import { HostService } from "./hostService.js";

/** Loads agent configs from yaml files, then syncs them to the database */
export async function createAgentRegistrar(
  hubConfig: HubConfig,
  dbService: DatabaseService,
  hostService: HostService,
  startupAgentPath?: string,
) {
  const { localHostId } = hostService;
  await reloadAgents();

  async function reloadAgents() {
    const naisysFolder = hubConfig.hubConfig().naisysFolder;
    if (!naisysFolder) {
      throw new Error("naisysFolder is not configured (NAISYS_FOLDER env var)");
    }

    const users = loadAgentConfigs(naisysFolder, startupAgentPath);

    await syncUsersToDatabase(users);
  }

  async function syncUsersToDatabase(users: Map<string, UserEntry>) {
    // Load all existing users from database (filtered by host)
    const existingUsers = await dbService.usingDatabase(async (prisma) => {
      return await prisma.users.findMany({
        where: { host_id: localHostId },
      });
    });

    const userMap = new Map(existingUsers.map((u) => [u.username, u]));

    for (const [username, entry] of users) {
      const existingUser = userMap.get(username);

      await dbService.usingDatabase(async (prisma) => {
        // Resolve lead agent username to user ID if specified
        let leadUserId: string | null = null;
        if (entry.config.leadAgent) {
          const leadUser = await prisma.users.findFirst({
            where: {
              username: entry.config.leadAgent,
              host_id: localHostId,
            },
            select: { id: true },
          });
          leadUserId = leadUser?.id ?? null;
        }

        if (!existingUser) {
          const user = await prisma.users.create({
            data: {
              id: ulid(),
              username,
              title: entry.config.title,
              agent_path: entry.agentPath,
              lead_user_id: leadUserId,
              config: entry.configYaml,
              host_id: localHostId,
            },
          });

          console.log(`Created user: ${username} from ${entry.agentPath}`);

          await prisma.user_notifications.create({
            data: {
              user_id: user.id,
              host_id: localHostId,
              latest_log_id: "",
            },
          });
        } else {
          const changes: string[] = [];

          if (existingUser.title !== entry.config.title) {
            changes.push(
              `title: "${existingUser.title}" -> "${entry.config.title}"`,
            );
          }
          if (existingUser.agent_path !== entry.agentPath) {
            changes.push(
              `agent_path: "${existingUser.agent_path}" -> "${entry.agentPath}"`,
            );
          }
          if (existingUser.lead_user_id !== leadUserId) {
            changes.push(
              `lead_user_id: "${existingUser.lead_user_id}" -> "${leadUserId}"`,
            );
          }
          if (existingUser.config !== entry.configYaml) {
            changes.push(`config: updated`);
          }

          if (changes.length > 0) {
            console.log(
              `Updated user ${username}: ${changes.join(", ")} from ${entry.agentPath}`,
            );

            await prisma.users.update({
              where: {
                username_host_id: {
                  username,
                  host_id: localHostId,
                },
              },
              data: {
                title: entry.config.title,
                agent_path: entry.agentPath,
                lead_user_id: leadUserId,
                config: entry.configYaml,
              },
            });

            await prisma.user_notifications.upsert({
              where: { user_id: existingUser.id },
              create: {
                user_id: existingUser.id,
                host_id: localHostId,
                latest_log_id: "",
              },
              update: {
                updated_at: new Date().toISOString(),
              },
            });
          }
        }
      });
    }
  }

  return {
    reloadAgents,
  };
}

export type AgentRegistrar = Awaited<ReturnType<typeof createAgentRegistrar>>;

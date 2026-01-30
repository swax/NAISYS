import { DatabaseService } from "@naisys/database";
import { HubEvents } from "@naisys/hub-protocol";
import { HostService } from "./hostService.js";
import { HubServerLog } from "./hubServerLog.js";
import { RunnerServer } from "./runnerServer.js";

/** Pushes the user list to runners when they connect */
export function createHubUserService(
  runnerServer: RunnerServer,
  dbService: DatabaseService,
  hostService: HostService,
  logService: HubServerLog,
) {
  const { localHostId } = hostService;

  runnerServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (runnerId: string) => {
      try {
        const dbUsers = await dbService.usingDatabase(async (prisma) => {
          return await prisma.users.findMany({
            where: { host_id: localHostId, deleted_at: null },
            select: { username: true, config: true, agent_path: true },
          });
        });

        const users = dbUsers.map((u) => ({
          username: u.username,
          configYaml: u.config,
          agentPath: u.agent_path,
        }));

        logService.log(
          `[HubUserService] Pushing ${users.length} users to runner ${runnerId}`,
        );

        runnerServer.sendMessage(runnerId, HubEvents.USER_LIST, {
          success: true,
          users,
        });
      } catch (error) {
        logService.error(
          `[HubUserService] Error querying users for runner ${runnerId}: ${error}`,
        );
        runnerServer.sendMessage(runnerId, HubEvents.USER_LIST, {
          success: false,
          error: String(error),
        });
      }
    },
  );
}

import { DatabaseService } from "@naisys/database";
import { HubEvents, UserListResponse } from "@naisys/hub-protocol";
import { HostService } from "./hostService.js";
import { HubServerLog } from "./hubServerLog.js";
import { RunnerServer } from "./runnerServer.js";

/** Handles user_list requests from runners by querying the hub's database */
export function createHubUserService(
  runnerServer: RunnerServer,
  dbService: DatabaseService,
  hostService: HostService,
  logService: HubServerLog,
) {
  const { localHostId } = hostService;

  runnerServer.registerEvent(
    HubEvents.USER_LIST,
    async (
      runnerId: string,
      _data: unknown,
      ack?: (response: UserListResponse) => void,
    ) => {
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
          `[HubUserService] Returning ${users.length} users to runner ${runnerId}`,
        );

        ack?.({ success: true, users });
      } catch (error) {
        logService.error(
          `[HubUserService] Error querying users for runner ${runnerId}: ${error}`,
        );
        ack?.({ success: false, error: String(error) });
      }
    },
  );
}

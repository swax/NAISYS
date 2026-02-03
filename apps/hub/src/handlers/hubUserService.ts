import { DatabaseService } from "@naisys/database";
import { HubEvents, UserListResponse } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the user list to NAISYS instances when they connect */
export function createHubUserService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (hostId: string) => {
      try {
        const dbUsers = await dbService.usingDatabase(async (prisma) => {
          return await prisma.users.findMany({
            where: { deleted_at: null },
            select: { id: true, username: true, config: true, agent_path: true, lead_user_id: true },
          });
        });

        const users = dbUsers.map((u) => ({
          userId: u.id,
          username: u.username,
          leadUserId: u.lead_user_id || undefined,
          configYaml: u.config,
        }));

        logService.log(
          `[HubUserService] Pushing ${users.length} users to naisys instance ${hostId}`,
        );

        naisysServer.sendMessage(hostId, HubEvents.USER_LIST, {
          success: true,
          users,
        } satisfies UserListResponse);
      } catch (error) {
        logService.error(
          `[HubUserService] Error querying users for naisys instance ${hostId}: ${error}`,
        );
        naisysServer.sendMessage(hostId, HubEvents.USER_LIST, {
          success: false,
          error: String(error),
        });
      }
    },
  );
}

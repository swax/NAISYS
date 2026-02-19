import { DatabaseService } from "@naisys/hub-database";
import { HubEvents, UserListResponse } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the user list to NAISYS instances when they connect or when users change */
export function createHubUserService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  async function buildUserListPayload(): Promise<UserListResponse> {
    const dbUsers = await dbService.usingDatabase(async (prisma) => {
      return await prisma.users.findMany({
        where: { archived: false },
        select: {
          id: true,
          username: true,
          config: true,
          lead_user_id: true,
          api_key: true,
          user_hosts: {
            select: { host_id: true },
          },
        },
      });
    });

    const users = dbUsers.map((u) => ({
      userId: u.id,
      username: u.username,
      leadUserId: u.lead_user_id || undefined,
      configYaml: u.config,
      assignedHostIds:
        u.user_hosts.length > 0
          ? u.user_hosts.map((uh) => uh.host_id)
          : undefined,
      apiKey: u.api_key || undefined,
    }));

    return { success: true, users };
  }

  async function broadcastUserList() {
    try {
      const payload = await buildUserListPayload();
      const clients = naisysServer.getConnectedClients();

      logService.log(
        `[Hub:Users] Broadcasting ${payload.users?.length ?? 0} users to ${clients.length} clients`,
      );

      for (const connection of clients) {
        naisysServer.sendMessage<UserListResponse>(
          connection.getHostId(),
          HubEvents.USERS_UPDATED,
          payload,
        );
      }
    } catch (error) {
      logService.error(`[Hub:Users] Error broadcasting user list: ${error}`);
    }
  }

  // Push user list to newly connected clients
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (hostId: number) => {
      try {
        const payload = await buildUserListPayload();

        logService.log(
          `[Hub:Users] Pushing ${payload.users?.length ?? 0} users to naisys instance ${hostId}`,
        );

        naisysServer.sendMessage<UserListResponse>(
          hostId,
          HubEvents.USERS_UPDATED,
          payload,
        );
      } catch (error) {
        logService.error(
          `[Hub:Users] Error querying users for naisys instance ${hostId}: ${error}`,
        );
        naisysServer.sendMessage<UserListResponse>(
          hostId,
          HubEvents.USERS_UPDATED,
          {
            success: false,
            error: String(error),
          },
        );
      }
    },
  );

  // Broadcast user list to all clients when users are created/edited
  naisysServer.registerEvent(
    HubEvents.USERS_CHANGED,
    async (_hostId: number) => {
      await broadcastUserList();
    },
  );
}

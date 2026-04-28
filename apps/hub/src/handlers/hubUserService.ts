import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import { HubEvents, type UserListResponse } from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";

/** Pushes the user list to NAISYS instances when they connect or when users change */
export function createHubUserService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
) {
  async function buildUserListPayload(): Promise<UserListResponse> {
    const dbUsers = await hubDb.users.findMany({
      where: { archived: false },
      select: {
        id: true,
        username: true,
        enabled: true,
        config: true,
        lead_user_id: true,
        user_hosts: {
          select: { host_id: true },
        },
      },
    });

    const users = dbUsers.map((u) => ({
      userId: u.id,
      username: u.username,
      enabled: u.enabled,
      leadUserId: u.lead_user_id || undefined,
      config: JSON.parse(u.config),
      assignedHostIds:
        u.user_hosts.length > 0
          ? u.user_hosts.map((uh) => uh.host_id)
          : undefined,
    }));

    return { success: true, users };
  }

  async function broadcastUserList() {
    try {
      const payload = await buildUserListPayload();

      logService.log(
        `[Hub:Users] Broadcasting ${payload.users?.length ?? 0} users to all clients`,
      );

      naisysServer.broadcastToAll(HubEvents.USERS_UPDATED, payload);
    } catch (error) {
      logService.error(`[Hub:Users] Error broadcasting user list: ${error}`);
    }
  }

  // Push user list to newly connected clients
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (hostId, connection) => {
      try {
        const payload = await buildUserListPayload();

        logService.log(
          `[Hub:Users] Pushing ${payload.users?.length ?? 0} users to instance ${hostId}`,
        );

        connection.sendMessage(HubEvents.USERS_UPDATED, payload);
      } catch (error) {
        logService.error(
          `[Hub:Users] Error querying users for instance ${hostId}: ${error}`,
        );
        connection.sendMessage(HubEvents.USERS_UPDATED, {
          success: false,
          error: String(error),
        });
      }
    },
  );

  // Broadcast user list to all clients when users are created/edited
  naisysServer.registerEvent(HubEvents.USERS_CHANGED, async () => {
    await broadcastUserList();
  });
}

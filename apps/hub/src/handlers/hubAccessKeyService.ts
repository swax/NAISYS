import type { DualLogger } from "@naisys/common-node";
import { HubEvents, RotateAccessKeyRequestSchema } from "@naisys/hub-protocol";

import { rotateAccessKey } from "../services/accessKeyService.js";
import type { NaisysServer } from "../services/naisysServer.js";

/**
 * Handles hub access key rotation requests from the supervisor.
 * Rotates the key, updates auth, and disconnects all clients.
 * The new key is returned only to the requesting supervisor via ack;
 * all other clients must be manually given the new key.
 */
export function createHubAccessKeyService(
  naisysServer: NaisysServer,
  logService: DualLogger,
) {
  naisysServer.registerEvent(
    HubEvents.ROTATE_ACCESS_KEY,
    (_hostId, _data, ack) => {
      try {
        const newAccessKey = rotateAccessKey();

        // Update the hub's auth middleware to accept the new key
        naisysServer.updateHubAccessKey(newAccessKey);

        logService.log(`[Hub:AccessKey] Access key rotated successfully`);

        // Respond to the requesting supervisor before disconnecting
        ack({ success: true, newAccessKey });

        // Disconnect all clients — they'll need the new key to reconnect
        logService.log(
          `[Hub:AccessKey] Disconnecting all clients after key rotation`,
        );
        naisysServer.disconnectAllClients();
      } catch (error) {
        logService.error(
          `[Hub:AccessKey] Failed to rotate access key: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
    RotateAccessKeyRequestSchema,
  );
}

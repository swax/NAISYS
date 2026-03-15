import { buildClientConfig } from "@naisys/common";
import type { HubDatabaseService } from "@naisys/hub-database";
import { ConfigResponse, HubEvents } from "@naisys/hub-protocol";
import dotenv from "dotenv";

import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the global config to NAISYS instances when they connect or when variables change */
export async function createHubConfigService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: HubServerLog,
) {
  let cachedConfig: ConfigResponse = {
    success: false,
    error: "Not yet loaded",
  };

  // Seed DB from .env on first run
  const existing = await hubDb.variables.findMany();
  if (existing.length > 0) {
    logService.log("[Hub:Config] .env variables already seeded");
  } else {
    // First run: seed from .env file only (not all of process.env)
    const { parsed: dotenvVars } = dotenv.config({ quiet: true });
    const fileConfig = buildClientConfig(dotenvVars ?? {});
    const entries = Object.entries(fileConfig.variableMap);
    if (entries.length > 0) {
      await hubDb.variables.createMany({
        data: entries.map(([key, value]) => ({
          key,
          value,
          created_by: "hub",
          updated_by: "hub",
        })),
      });
    }

    logService.log(
      `[Hub:Config] Seeded ${entries.length} variables from .env file into database`,
    );
  }

  /** Read variables from DB and build a ConfigResponse */
  async function buildConfigPayload(): Promise<ConfigResponse> {
    const rows = await hubDb.variables.findMany();
    const variableMap: Record<string, string> = {};
    for (const row of rows) {
      variableMap[row.key] = row.value;
    }

    cachedConfig = {
      success: true,
      config: buildClientConfig(variableMap),
    };
    return cachedConfig;
  }

  /** Broadcast current config to all connected clients */
  async function broadcastConfig() {
    try {
      const payload = await buildConfigPayload();

      logService.log(`[Hub:Config] Broadcasting config to all clients`);

      naisysServer.broadcastToAll(HubEvents.VARIABLES_UPDATED, payload);
    } catch (error) {
      logService.error(`[Hub:Config] Error broadcasting config: ${error}`);
    }
  }

  // Push config to newly connected clients
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (hostId, connection) => {
      try {
        const payload = await buildConfigPayload();

        logService.log(
          `[Hub:Config] Pushing config to instance ${hostId}`,
        );

        connection.sendMessage(HubEvents.VARIABLES_UPDATED, payload);
      } catch (error) {
        logService.error(
          `[Hub:Config] Error sending config to instance ${hostId}: ${error}`,
        );
        connection.sendMessage(HubEvents.VARIABLES_UPDATED, {
          success: false,
          error: String(error),
        });
      }
    },
  );

  // Broadcast config to all clients when variables change
  naisysServer.registerEvent(HubEvents.VARIABLES_CHANGED, async () => {
    await broadcastConfig();
  });

  // Build initial config so it's available immediately
  await buildConfigPayload();

  return {
    getConfig: () => cachedConfig,
  };
}

export type HubConfigService = Awaited<
  ReturnType<typeof createHubConfigService>
>;

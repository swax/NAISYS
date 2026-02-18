import { buildClientConfig } from "@naisys/common";
import type { DatabaseService } from "@naisys/database";
import { ConfigResponse, HubEvents } from "@naisys/hub-protocol";
import dotenv from "dotenv";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the global config to NAISYS instances when they connect or when variables change */
export async function createHubConfigService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  let cachedConfig: ConfigResponse = {
    success: false,
    error: "Not yet loaded",
  };

  // Seed DB from .env on first run
  await dbService.usingDatabase(async (prisma) => {
    const existing = await prisma.variables.findMany();
    if (existing.length > 0) {
      logService.log("[Hub:Config] .env variables already seeded");
      return;
    }

    // First run: seed from .env file only (not all of process.env)
    const { parsed: dotenvVars } = dotenv.config({ quiet: true });
    const fileConfig = buildClientConfig(dotenvVars ?? {});
    const entries = Object.entries(fileConfig.variableMap);
    if (entries.length > 0) {
      await prisma.variables.createMany({
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
  });

  /** Read variables from DB and build a ConfigResponse */
  async function buildConfigPayload(): Promise<ConfigResponse> {
    const variableMap = await dbService.usingDatabase(async (prisma) => {
      const rows = await prisma.variables.findMany();
      const map: Record<string, string> = {};
      for (const row of rows) {
        map[row.key] = row.value;
      }
      return map;
    });

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
      const clients = naisysServer.getConnectedClients();

      logService.log(
        `[Hub:Config] Broadcasting config to ${clients.length} clients`,
      );

      for (const connection of clients) {
        naisysServer.sendMessage<ConfigResponse>(
          connection.getHostId(),
          HubEvents.VARIABLES_UPDATED,
          payload,
        );
      }
    } catch (error) {
      logService.error(`[Hub:Config] Error broadcasting config: ${error}`);
    }
  }

  // Push config to newly connected clients
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (hostId: number) => {
      try {
        const payload = await buildConfigPayload();

        logService.log(
          `[Hub:Config] Pushing config to naisys instance ${hostId}`,
        );

        naisysServer.sendMessage<ConfigResponse>(
          hostId,
          HubEvents.VARIABLES_UPDATED,
          payload,
        );
      } catch (error) {
        logService.error(
          `[Hub:Config] Error sending config to naisys instance ${hostId}: ${error}`,
        );
        naisysServer.sendMessage<ConfigResponse>(
          hostId,
          HubEvents.VARIABLES_UPDATED,
          {
            success: false,
            error: String(error),
          },
        );
      }
    },
  );

  // Broadcast config to all clients when variables change
  naisysServer.registerEvent(
    HubEvents.VARIABLES_CHANGED,
    async (_hostId: number) => {
      await broadcastConfig();
    },
  );

  // Build initial config so it's available immediately
  await buildConfigPayload();

  return {
    getConfig: () => cachedConfig,
  };
}

export type HubConfigService = Awaited<
  ReturnType<typeof createHubConfigService>
>;

import { buildClientConfig } from "@naisys/common";
import type { DatabaseService } from "@naisys/database";
import { ConfigResponse, HubEvents } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the global config to NAISYS instances when they connect */
export async function createHubConfigService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  // Seed DB from .env on first run, then always read from DB
  const variableMap = await dbService.usingDatabase(async (prisma) => {
    const existing = await prisma.variables.findMany();
    if (existing.length > 0) {
      const map: Record<string, string> = {};
      for (const row of existing) {
        map[row.key] = row.value;
      }
      return map;
    }

    // First run: seed from process.env (which includes .env via dotenv)
    const fileConfig = buildClientConfig(process.env);
    const entries = Object.entries(fileConfig.variableMap);
    if (entries.length > 0) {
      await prisma.variables.createMany({
        data: entries.map(([key, value]) => ({ key, value })),
      });
    }
    return fileConfig.variableMap;
  });

  // Build full config using DB-sourced env vars
  const clientConfig = buildClientConfig(variableMap);

  naisysServer.registerEvent(HubEvents.CLIENT_CONNECTED, (hostId: number) => {
    try {
      logService.log(
        `[HubConfigService] Pushing config to naisys instance ${hostId}`,
      );

      naisysServer.sendMessage<ConfigResponse>(hostId, HubEvents.CONFIG, {
        success: true,
        config: clientConfig,
      });
    } catch (error) {
      logService.error(
        `[HubConfigService] Error sending config to naisys instance ${hostId}: ${error}`,
      );
      naisysServer.sendMessage<ConfigResponse>(hostId, HubEvents.CONFIG, {
        success: false,
        error: String(error),
      });
    }
  });
}

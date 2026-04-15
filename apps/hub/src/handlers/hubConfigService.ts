import { buildClientConfig } from "@naisys/common";
import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import type { ConfigResponse } from "@naisys/hub-protocol";
import { HubEvents } from "@naisys/hub-protocol";
import dotenv from "dotenv";

import type { NaisysServer } from "../services/naisysServer.js";

/** Pushes the global config to NAISYS instances when they connect or when variables change */
export async function createHubConfigService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
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

  // Ensure well-known variables exist so they show up in supervisor UI
  await ensureVariables(hubDb, [
    { key: "GOOGLE_SEARCH_ENGINE_ID" },
    { key: "SPEND_LIMIT_DOLLARS" },
    { key: "SPEND_LIMIT_HOURS" },
    { key: "TARGET_VERSION" },
  ]);

  /** Read variables from DB and build a ConfigResponse */
  async function buildConfigPayload(): Promise<ConfigResponse> {
    const rows = await hubDb.variables.findMany();
    const variableMap: Record<string, string> = {};
    const shellExportKeys = new Set<string>();
    for (const row of rows) {
      variableMap[row.key] = row.value;
      if (row.export_to_shell) {
        shellExportKeys.add(row.key);
      }
    }

    cachedConfig = {
      success: true,
      config: buildClientConfig(variableMap, shellExportKeys),
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

        logService.log(`[Hub:Config] Pushing config to instance ${hostId}`);

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

/** Create variable placeholders if they don't already exist */
export async function ensureVariables(
  hubDb: HubDatabaseService["hubDb"],
  keys: { key: string; sensitive?: boolean }[],
) {
  for (const { key, sensitive } of keys) {
    const existing = await hubDb.variables.findUnique({ where: { key } });
    if (!existing) {
      await hubDb.variables.create({
        data: {
          key,
          value: "",
          sensitive: sensitive ?? false,
          export_to_shell: false,
          created_by: "hub",
          updated_by: "hub",
        },
      });
    }
  }
}

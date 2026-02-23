import {
  builtInImageModels,
  builtInLlmModels,
  dbFieldsToImageModel,
  dbFieldsToLlmModel,
  imageModelToDbFields,
  llmModelToDbFields,
  type ModelDbFields,
  type ModelDbRow,
} from "@naisys/common";
import { loadCustomModels } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import { HubEvents, ModelsResponse } from "@naisys/hub-protocol";

import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Hub handler that seeds models on startup, pushes them on connect, and broadcasts on change */
export async function createHubModelsService(
  naisysServer: NaisysServer,
  { usingHubDatabase }: HubDatabaseService,
  logService: HubServerLog,
) {
  // Seed models table from built-in + YAML custom models (one-time, skips if non-empty)
  await seedModels(usingHubDatabase, logService);

  async function buildModelsPayload(): Promise<ModelsResponse> {
    const rows = (await usingHubDatabase(async (hubDb) => {
      return await hubDb.models.findMany();
    })) as ModelDbRow[];

    const llmModels = rows
      .filter((r) => r.type === "llm")
      .map((r) => dbFieldsToLlmModel(r));

    const imageModels = rows
      .filter((r) => r.type === "image")
      .map((r) => dbFieldsToImageModel(r));

    return { success: true, llmModels, imageModels };
  }

  async function broadcastModels() {
    try {
      const payload = await buildModelsPayload();
      const clients = naisysServer.getConnectedClients();

      logService.log(
        `[Hub:Models] Broadcasting ${payload.llmModels?.length ?? 0} LLM + ${payload.imageModels?.length ?? 0} image models to ${clients.length} clients`,
      );

      for (const connection of clients) {
        naisysServer.sendMessage<ModelsResponse>(
          connection.getHostId(),
          HubEvents.MODELS_UPDATED,
          payload,
        );
      }
    } catch (error) {
      logService.error(`[Hub:Models] Error broadcasting models: ${error}`);
    }
  }

  // Push models to newly connected clients
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (hostId: number) => {
      try {
        const payload = await buildModelsPayload();

        logService.log(
          `[Hub:Models] Pushing ${payload.llmModels?.length ?? 0} LLM + ${payload.imageModels?.length ?? 0} image models to naisys instance ${hostId}`,
        );

        naisysServer.sendMessage<ModelsResponse>(
          hostId,
          HubEvents.MODELS_UPDATED,
          payload,
        );
      } catch (error) {
        logService.error(
          `[Hub:Models] Error querying models for naisys instance ${hostId}: ${error}`,
        );
        naisysServer.sendMessage<ModelsResponse>(
          hostId,
          HubEvents.MODELS_UPDATED,
          {
            success: false,
            error: String(error),
          },
        );
      }
    },
  );

  // Broadcast models to all clients when supervisor saves/deletes a model
  naisysServer.registerEvent(
    HubEvents.MODELS_CHANGED,
    async (_hostId: number) => {
      await broadcastModels();
    },
  );
}

/** Seeds models table from built-in models + any YAML custom models.
 *  Built-in models are upserted on every startup unless the user has customized them.
 *  YAML custom models are only imported on first run (empty table). */
async function seedModels(
  usingHubDatabase: HubDatabaseService["usingHubDatabase"],
  logService: HubServerLog,
) {
  await usingHubDatabase(async (hubDb) => {
    const existingRows = (await hubDb.models.findMany()) as ModelDbRow[];
    const isFirstRun = existingRows.length === 0;

    // Upsert built-in models that haven't been customized
    const builtInFields: ModelDbFields[] = [
      ...builtInLlmModels.map((m) => llmModelToDbFields(m, true, false)),
      ...builtInImageModels.map((m) => imageModelToDbFields(m, true, false)),
    ];

    let upsertCount = 0;
    for (const fields of builtInFields) {
      const existing = existingRows.find((r) => r.key === fields.key);
      if (existing?.is_custom) {
        // User has customized this built-in model, don't overwrite
        continue;
      }
      if (existing) {
        await hubDb.models.update({ where: { key: fields.key }, data: fields });
      } else {
        await hubDb.models.create({ data: fields });
      }
      upsertCount++;
    }

    // Import YAML custom models only on first run (migration from file-based storage)
    if (isFirstRun) {
      const custom = loadCustomModels(process.env.NAISYS_FOLDER || "");
      const customRows: ModelDbFields[] = [];

      for (const m of custom.llmModels ?? []) {
        const isBuiltin = builtInLlmModels.some((b) => b.key === m.key);
        const fields = llmModelToDbFields(m, isBuiltin, true);
        if (isBuiltin) {
          // Override the built-in row we just inserted
          await hubDb.models.update({ where: { key: m.key }, data: fields });
        } else {
          customRows.push(fields);
        }
      }

      for (const m of custom.imageModels ?? []) {
        const isBuiltin = builtInImageModels.some((b) => b.key === m.key);
        const fields = imageModelToDbFields(m, isBuiltin, true);
        if (isBuiltin) {
          await hubDb.models.update({ where: { key: m.key }, data: fields });
        } else {
          customRows.push(fields);
        }
      }

      if (customRows.length > 0) {
        await hubDb.models.createMany({ data: customRows });
      }

      logService.log(
        `[Hub:Models] First run: imported ${(custom.llmModels?.length ?? 0) + (custom.imageModels?.length ?? 0)} custom models from YAML`,
      );
    } else {
      logService.log(`[Hub:Models] Models already seeded`);
    }
  });
}

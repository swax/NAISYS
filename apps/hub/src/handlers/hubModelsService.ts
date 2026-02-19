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
import { DatabaseService } from "@naisys/hub-database";
import { HubEvents, ModelsResponse } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Hub handler that seeds models on startup, pushes them on connect, and broadcasts on change */
export async function createHubModelsService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  // Seed models table from built-in + YAML custom models (one-time, skips if non-empty)
  await seedModels(dbService, logService);

  async function buildModelsPayload(): Promise<ModelsResponse> {
    const rows = (await dbService.usingDatabase(async (prisma) => {
      return await prisma.models.findMany();
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

/** Seeds models table from built-in models + any YAML custom models (one-time). */
async function seedModels(
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  await dbService.usingDatabase(async (prisma) => {
    const count = await prisma.models.count();
    if (count > 0) {
      logService.log(`[Hub:Models] Models already seeded`);
      return;
    }
    // Start with all built-in models
    const rows: ModelDbFields[] = [
      ...builtInLlmModels.map((m) => llmModelToDbFields(m, true, false)),
      ...builtInImageModels.map((m) => imageModelToDbFields(m, true, false)),
    ];

    // Merge custom models from YAML (migration from file-based storage)
    const custom = loadCustomModels(process.env.NAISYS_FOLDER || "");

    for (const m of custom.llmModels ?? []) {
      const isBuiltin = builtInLlmModels.some((b) => b.key === m.key);
      const fields = llmModelToDbFields(m, isBuiltin, true);
      const idx = rows.findIndex((r) => r.key === m.key);
      if (idx >= 0) {
        rows[idx] = fields; // override built-in
      } else {
        rows.push(fields); // new custom model
      }
    }

    for (const m of custom.imageModels ?? []) {
      const isBuiltin = builtInImageModels.some((b) => b.key === m.key);
      const fields = imageModelToDbFields(m, isBuiltin, true);
      const idx = rows.findIndex((r) => r.key === m.key);
      if (idx >= 0) {
        rows[idx] = fields;
      } else {
        rows.push(fields);
      }
    }

    await prisma.models.createMany({ data: rows });
    logService.log(`[Hub:Models] Seeded ${rows.length} models into database`);
  });
}

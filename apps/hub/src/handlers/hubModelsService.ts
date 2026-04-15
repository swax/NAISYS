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
import type { DualLogger } from "@naisys/common-node";
import { loadCustomModels } from "@naisys/common-node";
import {
  type HubDatabaseService,
  type PrismaClient,
} from "@naisys/hub-database";
import type { ModelsResponse } from "@naisys/hub-protocol";
import { HubEvents } from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";
import { ensureVariables } from "./hubConfigService.js";

/** Hub handler that seeds models on startup, pushes them on connect, and broadcasts on change */
export async function createHubModelsService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
) {
  // Seed models table from built-in + YAML custom models (one-time, skips if non-empty)
  await seedModels(hubDb, logService);

  async function buildModelsPayload(): Promise<ModelsResponse> {
    const rows = (await hubDb.models.findMany()) as ModelDbRow[];

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

      logService.log(
        `[Hub:Models] Broadcasting ${payload.llmModels?.length ?? 0} LLM + ${payload.imageModels?.length ?? 0} image models to all clients`,
      );

      naisysServer.broadcastToAll(HubEvents.MODELS_UPDATED, payload);
    } catch (error) {
      logService.error(`[Hub:Models] Error broadcasting models: ${error}`);
    }
  }

  // Push models to newly connected clients
  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    async (hostId, connection) => {
      try {
        const payload = await buildModelsPayload();

        logService.log(
          `[Hub:Models] Pushing ${payload.llmModels?.length ?? 0} LLM + ${payload.imageModels?.length ?? 0} image models to instance ${hostId}`,
        );

        connection.sendMessage(HubEvents.MODELS_UPDATED, payload);
      } catch (error) {
        logService.error(
          `[Hub:Models] Error querying models for instance ${hostId}: ${error}`,
        );
        connection.sendMessage(HubEvents.MODELS_UPDATED, {
          success: false,
          error: String(error),
        });
      }
    },
  );

  // Broadcast models to all clients when supervisor saves/deletes a model
  naisysServer.registerEvent(HubEvents.MODELS_CHANGED, async () => {
    await broadcastModels();
  });
}

/** Seeds models table from built-in models + any YAML custom models.
 *  Built-in models are upserted on every startup unless the user has customized them.
 *  YAML custom models are only imported on first run (empty table). */
async function seedModels(hubDb: PrismaClient, logService: DualLogger) {
  const existingRows = (await hubDb.models.findMany()) as ModelDbRow[];
  const isFirstRun = existingRows.length === 0;

  // Upsert built-in models that haven't been customized
  const builtInFields: ModelDbFields[] = [
    ...builtInLlmModels.map((m) => llmModelToDbFields(m, true, false)),
    ...builtInImageModels.map((m) => imageModelToDbFields(m, true, false)),
  ];

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

  // Ensure API key variables referenced by built-in models exist in the variables table
  // so they show up in the supervisor UI for the user to configure
  const apiKeyVars = [
    ...new Set(
      [...builtInLlmModels, ...builtInImageModels]
        .map((m) => m.apiKeyVar)
        .filter(Boolean),
    ),
  ];
  await ensureVariables(
    hubDb,
    apiKeyVars.map((key) => ({ key, sensitive: true })),
  );
}

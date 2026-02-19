import type { LlmModel, ImageModel } from "@naisys/common";
import { getAllLlmModels, getAllImageModels } from "@naisys/common";
import { loadCustomModels } from "@naisys/common/dist/customModelsLoader.js";
import { HubEvents, ModelsResponseSchema } from "@naisys/hub-protocol";
import { HubClient } from "../hub/hubClient.js";

/** Provides model lookups, populated from hub (push) or disk (standalone) */
export function createModelService(hubClient: HubClient | undefined) {
  let llmModels: LlmModel[] = [];
  let imageModels: ImageModel[] = [];

  let modelsReadyPromise: Promise<void>;

  init();

  function init() {
    if (hubClient) {
      let resolveModels: () => void;
      let rejectModels: (error: Error) => void;

      modelsReadyPromise = new Promise<void>((resolve, reject) => {
        resolveModels = resolve;
        rejectModels = reject;
      });

      hubClient.registerEvent(HubEvents.MODELS_UPDATED, (data: unknown) => {
        try {
          const response = ModelsResponseSchema.parse(data);
          if (!response.success) {
            rejectModels(
              new Error(response.error || "Failed to get models from hub"),
            );
            return;
          }

          llmModels = response.llmModels ?? [];
          imageModels = response.imageModels ?? [];
          resolveModels();
        } catch (error) {
          rejectModels(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    } else {
      // Standalone mode: load from disk
      const custom = loadCustomModels(process.env.NAISYS_FOLDER || "");
      llmModels = getAllLlmModels(custom.llmModels);
      imageModels = getAllImageModels(custom.imageModels);
      modelsReadyPromise = Promise.resolve();
    }
  }

  function waitForModels(): Promise<void> {
    return modelsReadyPromise;
  }

  function getLlmModel(key: string): LlmModel {
    const model = llmModels.find((m) => m.key === key);
    if (!model) {
      throw new Error(`LLM model not found: ${key}`);
    }
    return model;
  }

  function getImageModel(key: string): ImageModel {
    const model = imageModels.find((m) => m.key === key);
    if (!model) {
      throw new Error(`Image model not found: ${key}`);
    }
    return model;
  }

  return {
    waitForModels,
    getLlmModel,
    getImageModel,
  };
}

export type ModelService = ReturnType<typeof createModelService>;

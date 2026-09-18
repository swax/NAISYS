import type { ImageModel, LlmModel } from "@naisys/common";
import {
  findLlmModel,
  findModel,
  getAllImageModels,
  getAllLlmModels,
  validateLlmModelAliases,
} from "@naisys/common";
import { loadCustomModels } from "@naisys/common-node";
import { HubEvents, ModelsResponseSchema } from "@naisys/hub-protocol";

import type { HubClient } from "../../hub/hubClient.js";

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

      hubClient.registerEvent(HubEvents.MODELS_UPDATED, (data) => {
        try {
          const response = ModelsResponseSchema.parse(data);
          if (!response.success) {
            rejectModels(
              new Error(response.error || "Failed to get models from hub"),
            );
            return;
          }

          const updatedModels = response.llmModels ?? [];
          validateLlmModelAliases(updatedModels);
          const updatedImages = response.imageModels ?? [];
          validateLlmModelAliases([...updatedModels, ...updatedImages]);
          llmModels = updatedModels;
          imageModels = updatedImages;
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
      validateLlmModelAliases([...llmModels, ...imageModels]);
      modelsReadyPromise = Promise.resolve();
    }
  }

  function waitForModels(): Promise<void> {
    return modelsReadyPromise;
  }

  function getLlmModel(key: string): LlmModel {
    const model = findLlmModel(llmModels, key);
    if (!model) {
      throw new Error(`LLM model not found: ${key}`);
    }
    return model;
  }

  function getImageModel(key: string): ImageModel {
    const model = findModel(imageModels, key);
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

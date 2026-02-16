import { getAllLlmModels, LlmApiType } from "@naisys/common";
import { loadCustomModels } from "@naisys/common/dist/customModelsLoader.js";

export { LlmApiType };

export function createLLModels() {
  const customModels = loadCustomModels();
  const llmModels = getAllLlmModels(customModels.llmModels);

  function get(key: string) {
    const model = llmModels.find((m) => m.key === key);

    if (!model) {
      throw `Error, model not found: ${key}`;
    }

    return model;
  }

  return {
    get,
  };
}

export type LLModels = ReturnType<typeof createLLModels>;

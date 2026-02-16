import {
  builtInLlmModels,
  builtInImageModels,
  type LlmModel,
  type ImageModel,
} from "@naisys/common";
import {
  loadCustomModels,
  saveCustomModels,
} from "@naisys/common/dist/customModelsLoader.js";

export function saveLlmModel(model: LlmModel): {
  success: boolean;
  message: string;
} {
  const custom = loadCustomModels();
  const llmModels = custom.llmModels ?? [];
  const idx = llmModels.findIndex((m) => m.key === model.key);
  if (idx >= 0) {
    llmModels[idx] = model;
  } else {
    llmModels.push(model);
  }
  saveCustomModels({ ...custom, llmModels });
  return { success: true, message: "LLM model saved" };
}

export function saveImageModel(model: ImageModel): {
  success: boolean;
  message: string;
} {
  const custom = loadCustomModels();
  const imageModels = custom.imageModels ?? [];
  const idx = imageModels.findIndex((m) => m.key === model.key);
  if (idx >= 0) {
    imageModels[idx] = model;
  } else {
    imageModels.push(model);
  }
  saveCustomModels({ ...custom, imageModels });
  return { success: true, message: "Image model saved" };
}

export function deleteLlmModel(key: string): {
  success: boolean;
  message: string;
  revertedToBuiltIn: boolean;
} {
  const custom = loadCustomModels();
  const llmModels = custom.llmModels ?? [];
  const idx = llmModels.findIndex((m) => m.key === key);
  if (idx < 0) {
    return {
      success: false,
      message: "Model not found in custom models",
      revertedToBuiltIn: false,
    };
  }
  llmModels.splice(idx, 1);
  saveCustomModels({ ...custom, llmModels });
  const revertedToBuiltIn = builtInLlmModels.some((m) => m.key === key);
  return {
    success: true,
    message: revertedToBuiltIn
      ? "Custom override removed, reverted to built-in"
      : "Custom model deleted",
    revertedToBuiltIn,
  };
}

export function deleteImageModel(key: string): {
  success: boolean;
  message: string;
  revertedToBuiltIn: boolean;
} {
  const custom = loadCustomModels();
  const imageModels = custom.imageModels ?? [];
  const idx = imageModels.findIndex((m) => m.key === key);
  if (idx < 0) {
    return {
      success: false,
      message: "Model not found in custom models",
      revertedToBuiltIn: false,
    };
  }
  imageModels.splice(idx, 1);
  saveCustomModels({ ...custom, imageModels });
  const revertedToBuiltIn = builtInImageModels.some((m) => m.key === key);
  return {
    success: true,
    message: revertedToBuiltIn
      ? "Custom override removed, reverted to built-in"
      : "Custom model deleted",
    revertedToBuiltIn,
  };
}

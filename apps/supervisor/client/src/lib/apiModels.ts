import type { SaveModelResponse, DeleteModelResponse } from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export const saveLlmModel = async (
  model: Record<string, unknown>,
): Promise<SaveModelResponse> => {
  try {
    return await api.put<{ model: Record<string, unknown> }, SaveModelResponse>(
      apiEndpoints.saveLlmModel,
      { model },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to save LLM model",
    };
  }
};

export const saveImageModel = async (
  model: Record<string, unknown>,
): Promise<SaveModelResponse> => {
  try {
    return await api.put<{ model: Record<string, unknown> }, SaveModelResponse>(
      apiEndpoints.saveImageModel,
      { model },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to save image model",
    };
  }
};

export const deleteModel = async (
  type: "llm" | "image",
  key: string,
): Promise<DeleteModelResponse> => {
  try {
    return await api.delete<DeleteModelResponse>(
      apiEndpoints.deleteModel(type, key),
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to delete model",
    };
  }
};

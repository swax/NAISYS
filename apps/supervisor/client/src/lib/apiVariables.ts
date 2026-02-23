import type { DeleteVariableResponse,SaveVariableResponse } from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export const saveVariable = async (
  key: string,
  value: string,
): Promise<SaveVariableResponse> => {
  try {
    return await api.put<{ value: string }, SaveVariableResponse>(
      apiEndpoints.saveVariable(key),
      { value },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to save variable",
    };
  }
};

export const deleteVariable = async (
  key: string,
): Promise<DeleteVariableResponse> => {
  try {
    return await api.delete<DeleteVariableResponse>(
      apiEndpoints.deleteVariable(key),
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to delete variable",
    };
  }
};

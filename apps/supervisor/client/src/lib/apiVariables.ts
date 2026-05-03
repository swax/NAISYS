import type {
  DeleteVariableResponse,
  OpenAiCodexOAuthPollResponse,
  OpenAiCodexOAuthStartResponse,
  OpenAiCodexOAuthUsageResponse,
  SaveVariableResponse,
} from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export const startOpenAiCodexOAuth =
  async (): Promise<OpenAiCodexOAuthStartResponse> =>
    await api.post<Record<string, never>, OpenAiCodexOAuthStartResponse>(
      apiEndpoints.openAiCodexOAuthStart,
      {},
    );

export const pollOpenAiCodexOAuth = async (
  flowId: string,
): Promise<OpenAiCodexOAuthPollResponse> =>
  await api.post<{ flowId: string }, OpenAiCodexOAuthPollResponse>(
    apiEndpoints.openAiCodexOAuthPoll,
    { flowId },
  );

export const checkOpenAiCodexOAuthUsage =
  async (): Promise<OpenAiCodexOAuthUsageResponse> =>
    await api.post<Record<string, never>, OpenAiCodexOAuthUsageResponse>(
      apiEndpoints.openAiCodexOAuthUsage,
      {},
    );

export const saveVariable = async (
  key: string,
  value: string,
  exportToShell: boolean,
  sensitive: boolean,
): Promise<SaveVariableResponse> => {
  try {
    return await api.put<
      { value: string; exportToShell: boolean; sensitive: boolean },
      SaveVariableResponse
    >(apiEndpoints.saveVariable(key), { value, exportToShell, sensitive });
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

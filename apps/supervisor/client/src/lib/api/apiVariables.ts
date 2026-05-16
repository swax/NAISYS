import type {
  CodexOAuthPollResponse,
  CodexOAuthStartResponse,
  CodexOAuthUsageResponse,
  DeleteVariableResponse,
  SaveVariableResponse,
} from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export const startCodexOAuth = async (): Promise<CodexOAuthStartResponse> =>
  await api.post<Record<string, never>, CodexOAuthStartResponse>(
    apiEndpoints.codexOAuthStart,
    {},
  );

export const pollCodexOAuth = async (
  flowId: string,
): Promise<CodexOAuthPollResponse> =>
  await api.post<{ flowId: string }, CodexOAuthPollResponse>(
    apiEndpoints.codexOAuthPoll,
    { flowId },
  );

export const checkCodexOAuthUsage =
  async (): Promise<CodexOAuthUsageResponse> =>
    await api.post<Record<string, never>, CodexOAuthUsageResponse>(
      apiEndpoints.codexOAuthUsage,
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

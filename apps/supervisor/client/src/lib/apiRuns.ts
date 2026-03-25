import type { ContextLogResponse, RunsDataResponse } from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export interface RunsDataParams {
  agentUsername: string;
  updatedSince?: string;
  page?: number;
  count?: number;
}

export const getRunsData = async (
  params: RunsDataParams,
): Promise<RunsDataResponse> => {
  const queryParams = new URLSearchParams();
  if (params.updatedSince) {
    queryParams.append("updatedSince", params.updatedSince);
  }
  if (params.page !== undefined) {
    queryParams.append("page", params.page.toString());
  }
  if (params.count !== undefined) {
    queryParams.append("count", params.count.toString());
  }

  const query = queryParams.toString();
  const url = `${apiEndpoints.agentRuns(params.agentUsername)}${query ? `?${query}` : ""}`;
  return await api.get<RunsDataResponse>(url);
};

export interface ContextLogParams {
  agentUsername: string;
  runId: number;
  sessionId: number;
  logsAfter?: number;
  logsBefore?: number;
}

export const getContextLog = async (
  params: ContextLogParams,
): Promise<ContextLogResponse> => {
  const queryParams = new URLSearchParams();
  if (params.logsAfter !== undefined) {
    queryParams.append("logsAfter", String(params.logsAfter));
  }
  if (params.logsBefore !== undefined) {
    queryParams.append("logsBefore", String(params.logsBefore));
  }

  const query = queryParams.toString();
  const url = `${apiEndpoints.agentContextLog(params.agentUsername, params.runId, params.sessionId)}${query ? `?${query}` : ""}`;
  return await api.get<ContextLogResponse>(url);
};

import type { ContextLogResponse, RunsDataResponse } from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export interface RunsDataParams {
  agentId: number;
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
  const url = `${apiEndpoints.agentRuns(params.agentId)}${query ? `?${query}` : ""}`;
  return await api.get<RunsDataResponse>(url);
};

export interface ContextLogParams {
  agentId: number;
  runId: number;
  sessionId: number;
  logsAfter?: number;
}

export const getContextLog = async (
  params: ContextLogParams,
): Promise<ContextLogResponse> => {
  const queryParams = new URLSearchParams();
  if (params.logsAfter !== undefined) {
    queryParams.append("logsAfter", String(params.logsAfter));
  }

  const query = queryParams.toString();
  const url = `${apiEndpoints.agentContextLog(params.agentId, params.runId, params.sessionId)}${query ? `?${query}` : ""}`;
  return await api.get<ContextLogResponse>(url);
};

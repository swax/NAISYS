import type {
  AgentRunCommandResult,
  AgentRunPauseResult,
  ContextLogResponse,
  RunsDataResponse,
} from "./apiClient";
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

export interface HostRunsParams {
  hostname: string;
  page?: number;
  count?: number;
}

export const getHostRuns = async (
  params: HostRunsParams,
): Promise<RunsDataResponse> => {
  const queryParams = new URLSearchParams();
  if (params.page !== undefined) {
    queryParams.append("page", params.page.toString());
  }
  if (params.count !== undefined) {
    queryParams.append("count", params.count.toString());
  }

  const query = queryParams.toString();
  const url = `${apiEndpoints.hostRuns(params.hostname)}${query ? `?${query}` : ""}`;
  return await api.get<RunsDataResponse>(url);
};

export interface ContextLogParams {
  agentUsername: string;
  runId: number;
  sessionId: number;
  subagentId?: number | null;
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
  const url = `${apiEndpoints.agentContextLog(params.agentUsername, params.runId, params.sessionId, params.subagentId)}${query ? `?${query}` : ""}`;
  return await api.get<ContextLogResponse>(url);
};

export const pauseRun = async (
  username: string,
  runId: number,
  sessionId: number,
  subagentId?: number | null,
): Promise<AgentRunPauseResult> => {
  return await api.post<Record<string, never>, AgentRunPauseResult>(
    apiEndpoints.agentRunPause(username, runId, sessionId, subagentId),
    {},
  );
};

export const resumeRun = async (
  username: string,
  runId: number,
  sessionId: number,
  subagentId?: number | null,
): Promise<AgentRunPauseResult> => {
  return await api.post<Record<string, never>, AgentRunPauseResult>(
    apiEndpoints.agentRunResume(username, runId, sessionId, subagentId),
    {},
  );
};

export const sendRunCommand = async (
  username: string,
  runId: number,
  sessionId: number,
  command: string,
  subagentId?: number | null,
): Promise<AgentRunCommandResult> => {
  return await api.post<{ command: string }, AgentRunCommandResult>(
    apiEndpoints.agentRunCommand(username, runId, sessionId, subagentId),
    { command },
  );
};

import type { AgentConfigFile } from "@naisys/common";

import type {
  AgentActionResult,
  AgentDetailResponse,
  AgentListResponse,
  AgentStartResult,
  AgentStopResult,
  CreateAgentConfigResponse,
  ExportAgentConfigResponse,
  GetAgentConfigResponse,
  HostDetailResponse,
  HostListResponse,
  ImportAgentConfigResponse,
  UpdateAgentConfigResponse,
} from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export interface AgentDataParams {
  updatedSince?: string;
}

export const getAgentData = async (
  params?: AgentDataParams,
): Promise<AgentListResponse> => {
  if (params?.updatedSince) {
    const queryParams = new URLSearchParams();
    queryParams.append("updatedSince", params.updatedSince);
    const url = `${apiEndpoints.agents}?${queryParams.toString()}`;
    return await api.get<AgentListResponse>(url);
  }
  return await api.get<AgentListResponse>(apiEndpoints.agents);
};

export const getHostData = async (): Promise<HostListResponse> => {
  return await api.get<HostListResponse>(apiEndpoints.hosts);
};

export const deleteHost = async (
  hostname: string,
): Promise<AgentActionResult> => {
  return await api.delete<AgentActionResult>(apiEndpoints.hostDelete(hostname));
};

export const getAgentDetail = async (
  username: string,
): Promise<AgentDetailResponse> => {
  return await api.get<AgentDetailResponse>(apiEndpoints.agentDetail(username));
};

export const getAgentConfig = async (
  username: string,
): Promise<GetAgentConfigResponse> => {
  return await api.get<GetAgentConfigResponse>(
    apiEndpoints.agentConfig(username),
  );
};

export const updateAgentConfig = async (
  username: string,
  config: AgentConfigFile,
): Promise<UpdateAgentConfigResponse> => {
  try {
    return await api.put<
      { config: AgentConfigFile },
      UpdateAgentConfigResponse
    >(apiEndpoints.agentConfig(username), { config });
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to save agent configuration",
    };
  }
};

export const importAgentConfig = async (
  username: string,
  yaml: string,
): Promise<ImportAgentConfigResponse> => {
  try {
    return await api.post<{ yaml: string }, ImportAgentConfigResponse>(
      apiEndpoints.agentConfigImport(username),
      { yaml },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to import agent configuration",
    };
  }
};

export const exportAgentConfig = async (
  username: string,
): Promise<ExportAgentConfigResponse> => {
  return await api.get<ExportAgentConfigResponse>(
    apiEndpoints.agentConfigExport(username),
  );
};

export const createAgent = async (
  name: string,
  title?: string,
): Promise<CreateAgentConfigResponse> => {
  try {
    return await api.post<
      { name: string; title?: string },
      CreateAgentConfigResponse
    >(apiEndpoints.agents, { name, ...(title ? { title } : {}) });
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to create agent",
    };
  }
};

export const startAgent = async (
  username: string,
  task?: string,
): Promise<AgentStartResult> => {
  return await api.post<{ task?: string }, AgentStartResult>(
    apiEndpoints.agentStart(username),
    task ? { task } : {},
  );
};

export const stopAgent = async (
  username: string,
  recursive?: boolean,
): Promise<AgentStopResult> => {
  return await api.post<{ recursive?: boolean }, AgentStopResult>(
    apiEndpoints.agentStop(username),
    recursive ? { recursive } : {},
  );
};

export const enableAgent = async (
  username: string,
  recursive?: boolean,
): Promise<AgentActionResult> => {
  return await api.post<{ recursive?: boolean }, AgentActionResult>(
    apiEndpoints.agentEnable(username),
    recursive ? { recursive } : {},
  );
};

export const disableAgent = async (
  username: string,
  recursive?: boolean,
): Promise<AgentActionResult> => {
  return await api.post<{ recursive?: boolean }, AgentActionResult>(
    apiEndpoints.agentDisable(username),
    recursive ? { recursive } : {},
  );
};

export const archiveAgent = async (
  username: string,
): Promise<AgentActionResult> => {
  return await api.post<{}, AgentActionResult>(
    apiEndpoints.agentArchive(username),
    {},
  );
};

export const unarchiveAgent = async (
  username: string,
): Promise<AgentActionResult> => {
  return await api.post<{}, AgentActionResult>(
    apiEndpoints.agentUnarchive(username),
    {},
  );
};

export const setAgentLead = async (
  username: string,
  leadAgentUsername: string | null,
): Promise<AgentActionResult> => {
  return await api.put<{ leadAgentUsername: string | null }, AgentActionResult>(
    apiEndpoints.agentLead(username),
    { leadAgentUsername },
  );
};

export const deleteAgentPermanently = async (
  username: string,
): Promise<AgentActionResult> => {
  return await api.delete<AgentActionResult>(
    apiEndpoints.agentDelete(username),
  );
};

// --- Host API functions ---

export const getHostDetail = async (
  hostname: string,
): Promise<HostDetailResponse> => {
  return await api.get<HostDetailResponse>(apiEndpoints.hostDetail(hostname));
};

export const createHostApi = async (
  name: string,
): Promise<AgentActionResult> => {
  return await api.post<{ name: string }, AgentActionResult>(
    apiEndpoints.hostCreate,
    { name },
  );
};

export const updateHostApi = async (
  hostname: string,
  data: { name?: string; restricted?: boolean },
): Promise<AgentActionResult> => {
  return await api.put<
    { name?: string; restricted?: boolean },
    AgentActionResult
  >(apiEndpoints.hostUpdate(hostname), data);
};

export const assignAgentToHost = async (
  hostname: string,
  agentId: number,
): Promise<AgentActionResult> => {
  return await api.post<{ agentId: number }, AgentActionResult>(
    apiEndpoints.hostAssignAgent(hostname),
    { agentId },
  );
};

export const unassignAgentFromHost = async (
  hostname: string,
  agentName: string,
): Promise<AgentActionResult> => {
  return await api.delete<AgentActionResult>(
    apiEndpoints.hostUnassignAgent(hostname, agentName),
  );
};

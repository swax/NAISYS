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

export const deleteHost = async (id: number): Promise<AgentActionResult> => {
  return await api.delete<AgentActionResult>(apiEndpoints.hostDelete(id));
};

export const getAgentDetail = async (
  id: number,
): Promise<AgentDetailResponse> => {
  return await api.get<AgentDetailResponse>(apiEndpoints.agentDetail(id));
};

export const getAgentConfig = async (
  id: number,
): Promise<GetAgentConfigResponse> => {
  return await api.get<GetAgentConfigResponse>(apiEndpoints.agentConfig(id));
};

export const updateAgentConfig = async (
  agentId: number,
  config: AgentConfigFile,
): Promise<UpdateAgentConfigResponse> => {
  try {
    return await api.put<
      { config: AgentConfigFile },
      UpdateAgentConfigResponse
    >(apiEndpoints.agentConfig(agentId), { config });
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
  agentId: number,
  yaml: string,
): Promise<ImportAgentConfigResponse> => {
  try {
    return await api.post<{ yaml: string }, ImportAgentConfigResponse>(
      apiEndpoints.agentConfigImport(agentId),
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
  agentId: number,
): Promise<ExportAgentConfigResponse> => {
  return await api.get<ExportAgentConfigResponse>(
    apiEndpoints.agentConfigExport(agentId),
  );
};

export const createAgent = async (
  name: string,
): Promise<CreateAgentConfigResponse> => {
  try {
    return await api.post<{ name: string }, CreateAgentConfigResponse>(
      apiEndpoints.agents,
      { name },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to create agent",
    };
  }
};

export const startAgent = async (
  id: number,
  task?: string,
): Promise<AgentStartResult> => {
  return await api.post<{ task?: string }, AgentStartResult>(
    apiEndpoints.agentStart(id),
    task ? { task } : {},
  );
};

export const stopAgent = async (id: number): Promise<AgentStopResult> => {
  return await api.post<{}, AgentStopResult>(apiEndpoints.agentStop(id), {});
};

export const archiveAgent = async (id: number): Promise<AgentActionResult> => {
  return await api.post<{}, AgentActionResult>(
    apiEndpoints.agentArchive(id),
    {},
  );
};

export const unarchiveAgent = async (
  id: number,
): Promise<AgentActionResult> => {
  return await api.post<{}, AgentActionResult>(
    apiEndpoints.agentUnarchive(id),
    {},
  );
};

export const setAgentLead = async (
  id: number,
  leadAgentId: number | null,
): Promise<AgentActionResult> => {
  return await api.put<{ leadAgentId: number | null }, AgentActionResult>(
    apiEndpoints.agentLead(id),
    { leadAgentId },
  );
};

export const deleteAgentPermanently = async (
  id: number,
): Promise<AgentActionResult> => {
  return await api.delete<AgentActionResult>(apiEndpoints.agentDelete(id));
};

// --- Host API functions ---

export const getHostDetail = async (
  id: number,
): Promise<HostDetailResponse> => {
  return await api.get<HostDetailResponse>(apiEndpoints.hostDetail(id));
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
  id: number,
  data: { name?: string; restricted?: boolean },
): Promise<AgentActionResult> => {
  return await api.put<
    { name?: string; restricted?: boolean },
    AgentActionResult
  >(apiEndpoints.hostUpdate(id), data);
};

export const assignAgentToHost = async (
  hostId: number,
  agentId: number,
): Promise<AgentActionResult> => {
  return await api.post<{ agentId: number }, AgentActionResult>(
    apiEndpoints.hostAssignAgent(hostId),
    { agentId },
  );
};

export const unassignAgentFromHost = async (
  hostId: number,
  agentId: number,
): Promise<AgentActionResult> => {
  return await api.delete<AgentActionResult>(
    apiEndpoints.hostUnassignAgent(hostId, agentId),
  );
};

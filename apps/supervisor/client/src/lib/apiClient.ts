import type { AgentConfigFile } from "@naisys/common";
import type {
  Agent,
  AgentDetailResponse,
  AgentListResponse,
  AgentStartResult,
  AgentStopResult,
  AuthUser,
  ContextLogResponse,
  CreateAgentConfigResponse,
  GetAgentConfigResponse,
  HostListResponse,
  LogEntry,
  LoginResponse,
  LogoutResponse,
  MailDataResponse,
  MailMessage,
  RunsDataResponse,
  RunSession,
  SendMailRequest,
  SendMailResponse,
  SettingsRequest,
  SettingsResponse,
  StatusResponse,
  UpdateAgentConfigResponse,
} from "@naisys-supervisor/shared";

const API_BASE = "/api/supervisor";

export type {
  Agent,
  AgentConfigFile,
  AgentDetailResponse,
  AgentListResponse,
  AgentStartResult,
  AgentStopResult,
  AuthUser,
  ContextLogResponse,
  CreateAgentConfigResponse,
  GetAgentConfigResponse,
  HostListResponse,
  LogEntry,
  LoginResponse,
  LogoutResponse,
  MailDataResponse,
  MailMessage,
  RunsDataResponse,
  RunSession,
  SendMailRequest,
  SendMailResponse,
  SettingsRequest,
  SettingsResponse,
  StatusResponse,
  UpdateAgentConfigResponse,
};

export const api = {
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    return response.json();
  },

  async post<T, R>(endpoint: string, data: T): Promise<R> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || `API Error: ${response.status}`);
    }
    return result;
  },

  async put<T, R>(endpoint: string, data: T): Promise<R> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || `API Error: ${response.status}`);
    }
    return result;
  },

  async delete<R>(endpoint: string): Promise<R> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || `API Error: ${response.status}`);
    }
    return result;
  },
};

export const SSE_STREAM_URL = `${API_BASE}/status/stream`;

export const apiEndpoints = {
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
  settings: "/settings",
  status: "/status",
  statusStream: "/status/stream",
  agents: "/agents",
  hosts: "/hosts",
  agentDetail: (id: number) => `/agents/${id}`,
  agentConfig: (id: number) => `/agents/${id}/config`,
  agentRuns: (id: number) => `/agents/${id}/runs`,
  agentMail: (id: number) => `/agents/${id}/mail`,
  agentContextLog: (id: number, runId: number, sessionId: number) =>
    `/agents/${id}/runs/${runId}/sessions/${sessionId}/logs`,
  agentStart: (id: number) => `/agents/${id}/start`,
  agentStop: (id: number) => `/agents/${id}/stop`,
  sendMail: "/send-mail",
};

export const getMe = async (): Promise<AuthUser> => {
  return await api.get<AuthUser>(apiEndpoints.me);
};

export const login = async (
  username: string,
  password: string,
): Promise<LoginResponse> => {
  return await api.post<{ username: string; password: string }, LoginResponse>(
    apiEndpoints.login,
    { username, password },
  );
};

export const logout = async (): Promise<LogoutResponse> => {
  return await api.post<{}, LogoutResponse>(apiEndpoints.logout, {});
};

export const getSettings = async (): Promise<SettingsResponse> => {
  try {
    return await api.get<SettingsResponse>(apiEndpoints.settings);
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to load settings",
    };
  }
};

export const saveSettings = async (
  settings: SettingsRequest,
): Promise<SettingsResponse> => {
  try {
    return await api.post<SettingsRequest, SettingsResponse>(
      apiEndpoints.settings,
      settings,
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to save settings",
    };
  }
};

export const getStatus = async (): Promise<StatusResponse> => {
  return await api.get<StatusResponse>(apiEndpoints.status);
};

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

export const sendMail = async (
  mailData: SendMailRequest & { files?: File[] },
): Promise<SendMailResponse> => {
  try {
    // If there are files, use FormData
    if (mailData.files && mailData.files.length > 0) {
      const formData = new FormData();
      formData.append("from", mailData.from);
      formData.append("to", mailData.to);
      formData.append("subject", mailData.subject);
      formData.append("message", mailData.message);

      // Add files to FormData
      mailData.files.forEach((file) => {
        formData.append(`attachments`, file);
      });

      const response = await fetch(`${API_BASE}${apiEndpoints.sendMail}`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || `API Error: ${response.status}`);
      }
      return result;
    } else {
      // No files, use regular JSON request
      return await api.post<SendMailRequest, SendMailResponse>(
        apiEndpoints.sendMail,
        mailData,
      );
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to send mail",
    };
  }
};

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

export interface MailDataParams {
  agentId: number;
  updatedSince?: string;
  page?: number;
  count?: number;
}

export const getMailData = async (
  params: MailDataParams,
): Promise<MailDataResponse> => {
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
  const url = `${apiEndpoints.agentMail(params.agentId)}${query ? `?${query}` : ""}`;
  return await api.get<MailDataResponse>(url);
};

export const updateAgentConfig = async (
  agentId: number,
  config: AgentConfigFile,
): Promise<UpdateAgentConfigResponse> => {
  try {
    return await api.put<{ config: AgentConfigFile }, UpdateAgentConfigResponse>(
      apiEndpoints.agentConfig(agentId),
      { config },
    );
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

export const startAgent = async (id: number): Promise<AgentStartResult> => {
  return await api.post<{}, AgentStartResult>(apiEndpoints.agentStart(id), {});
};

export const stopAgent = async (id: number): Promise<AgentStopResult> => {
  return await api.post<{}, AgentStopResult>(apiEndpoints.agentStop(id), {});
};

// --- Users API ---

/* eslint-disable @typescript-eslint/no-explicit-any */

export const getUsers = async (params: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<any> => {
  const queryParams = new URLSearchParams();
  if (params.page !== undefined) queryParams.set("page", String(params.page));
  if (params.pageSize !== undefined)
    queryParams.set("pageSize", String(params.pageSize));
  if (params.search) queryParams.set("search", params.search);
  return api.get(`/users?${queryParams}`);
};

export const getUser = async (id: number): Promise<any> => {
  return api.get(`/users/${id}`);
};

export const createUser = async (data: {
  username: string;
  password: string;
  authType?: string;
}): Promise<any> => {
  return api.post("/users", data);
};

export const updateUser = async (
  id: number,
  data: { username?: string; password?: string },
): Promise<any> => {
  return api.put(`/users/${id}`, data);
};

export const deleteUser = async (id: number): Promise<any> => {
  return api.delete(`/users/${id}`);
};

export const grantPermission = async (
  userId: number,
  permission: string,
): Promise<any> => {
  return api.post(`/users/${userId}/permissions`, { permission });
};

export const revokePermission = async (
  userId: number,
  permission: string,
): Promise<any> => {
  return api.delete(`/users/${userId}/permissions/${permission}`);
};

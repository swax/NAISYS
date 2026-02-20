import type { AgentConfigFile } from "@naisys/common";
import type {
  AdminInfoResponse,
  Agent,
  AgentActionResult,
  AgentDetailResponse,
  AgentListResponse,
  AgentStartResult,
  AgentStopResult,
  AuthUser,
  ContextLogResponse,
  CreateAgentConfigResponse,
  DeleteModelResponse,
  DeleteVariableResponse,
  GetAgentConfigResponse,
  HostListResponse,
  ImportAgentConfigResponse,
  ImageModelDetail,
  LlmModelDetail,
  LogEntry,
  LoginResponse,
  LogoutResponse,
  MailDataResponse,
  MailMessage,
  ModelsResponse,
  RunsDataResponse,
  RunSession,
  SaveModelResponse,
  SaveVariableResponse,
  SendMailRequest,
  SendMailResponse,
  StatusResponse,
  UpdateAgentConfigResponse,
  VariablesResponse,
} from "@naisys-supervisor/shared";

export const API_BASE = "/api/supervisor";

export type {
  AdminInfoResponse,
  Agent,
  AgentActionResult,
  AgentConfigFile,
  AgentDetailResponse,
  AgentListResponse,
  AgentStartResult,
  AgentStopResult,
  AuthUser,
  ContextLogResponse,
  CreateAgentConfigResponse,
  DeleteModelResponse,
  DeleteVariableResponse,
  GetAgentConfigResponse,
  HostListResponse,
  ImageModelDetail,
  ImportAgentConfigResponse,
  LlmModelDetail,
  LogEntry,
  LoginResponse,
  LogoutResponse,
  MailDataResponse,
  MailMessage,
  ModelsResponse,
  RunsDataResponse,
  RunSession,
  SaveModelResponse,
  SaveVariableResponse,
  SendMailRequest,
  SendMailResponse,
  StatusResponse,
  UpdateAgentConfigResponse,
  VariablesResponse,
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
  status: "/status",
  statusStream: "/status/stream",
  agents: "/agents",
  hosts: "/hosts",
  agentDetail: (id: number) => `/agents/${id}`,
  agentConfig: (id: number) => `/agents/${id}/config`,
  agentConfigImport: (id: number) => `/agents/${id}/config/import`,
  agentRuns: (id: number) => `/agents/${id}/runs`,
  agentMail: (id: number) => `/agents/${id}/mail`,
  agentContextLog: (id: number, runId: number, sessionId: number) =>
    `/agents/${id}/runs/${runId}/sessions/${sessionId}/logs`,
  agentStart: (id: number) => `/agents/${id}/start`,
  agentStop: (id: number) => `/agents/${id}/stop`,
  agentArchive: (id: number) => `/agents/${id}/archive`,
  agentUnarchive: (id: number) => `/agents/${id}/unarchive`,
  agentLead: (id: number) => `/agents/${id}/lead`,
  agentDelete: (id: number) => `/agents/${id}`,
  hostDelete: (id: number) => `/hosts/${id}`,
  models: "/models",
  saveLlmModel: "/models/llm",
  saveImageModel: "/models/image",
  deleteModel: (type: "llm" | "image", key: string) =>
    `/models/${type}/${encodeURIComponent(key)}`,
  variables: "/variables",
  saveVariable: (key: string) => `/variables/${encodeURIComponent(key)}`,
  deleteVariable: (key: string) => `/variables/${encodeURIComponent(key)}`,
  sendMail: "/send-mail",
  permissions: "/permissions",
  admin: "/admin",
  adminExportConfig: "/admin/export-config",
};

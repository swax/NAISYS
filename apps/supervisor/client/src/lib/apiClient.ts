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
  ChatConversation,
  ChatConversationsResponse,
  ChatMessage,
  ChatMessagesResponse,
  ContextLogResponse,
  CreateAgentConfigResponse,
  DeleteModelResponse,
  DeleteVariableResponse,
  ExportAgentConfigResponse,
  GetAgentConfigResponse,
  HostDetailResponse,
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
  SendChatRequest,
  SendChatResponse,
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
  ChatConversation,
  ChatConversationsResponse,
  ChatMessage,
  ChatMessagesResponse,
  ContextLogResponse,
  CreateAgentConfigResponse,
  DeleteModelResponse,
  DeleteVariableResponse,
  ExportAgentConfigResponse,
  GetAgentConfigResponse,
  HostDetailResponse,
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
  SendChatRequest,
  SendChatResponse,
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

export const apiEndpoints = {
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
  status: "/status",
  agents: "/agents",
  hosts: "/hosts",
  agentDetail: (username: string) => `/agents/${username}`,
  agentConfig: (username: string) => `/agents/${username}/config`,
  agentConfigImport: (username: string) => `/agents/${username}/config/import`,
  agentConfigExport: (username: string) => `/agents/${username}/config/export`,
  agentRuns: (username: string) => `/agents/${username}/runs`,
  agentMail: (username: string) => `/agents/${username}/mail`,
  agentChat: (username: string) => `/agents/${username}/chat`,
  agentChatMessages: (username: string, participantIds: string) =>
    `/agents/${username}/chat/${participantIds.replace(/,/g, "-")}`,
  agentContextLog: (username: string, runId: number, sessionId: number) =>
    `/agents/${username}/runs/${runId}/sessions/${sessionId}/logs`,
  agentStart: (username: string) => `/agents/${username}/start`,
  agentStop: (username: string) => `/agents/${username}/stop`,
  agentArchive: (username: string) => `/agents/${username}/archive`,
  agentUnarchive: (username: string) => `/agents/${username}/unarchive`,
  agentLead: (username: string) => `/agents/${username}/lead`,
  agentDelete: (username: string) => `/agents/${username}`,
  hostDetail: (id: number) => `/hosts/${id}`,
  hostUpdate: (id: number) => `/hosts/${id}`,
  hostCreate: "/hosts",
  hostAssignAgent: (id: number) => `/hosts/${id}/agents`,
  hostUnassignAgent: (id: number, agentId: number) =>
    `/hosts/${id}/agents/${agentId}`,
  hostDelete: (id: number) => `/hosts/${id}`,
  models: "/models",
  saveLlmModel: "/models/llm",
  saveImageModel: "/models/image",
  deleteModel: (type: "llm" | "image", key: string) =>
    `/models/${type}/${encodeURIComponent(key)}`,
  variables: "/variables",
  saveVariable: (key: string) => `/variables/${encodeURIComponent(key)}`,
  deleteVariable: (key: string) => `/variables/${encodeURIComponent(key)}`,
  attachmentDownload: (id: number) => `/attachments/${id}`,
  permissions: "/permissions",
  admin: "/admin",
  adminExportConfig: "/admin/export-config",
};

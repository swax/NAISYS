import type { AgentConfigFile } from "@naisys/common";
import type {
  AdminAttachmentListResponse,
  AdminInfoResponse,
  Agent,
  AgentActionResult,
  AgentDetailResponse,
  AgentListResponse,
  AgentStartResult,
  AgentStopResult,
  ArchiveChatResponse,
  ArchiveMailResponse,
  AuthUser,
  ChatConversation,
  ChatConversationsResponse,
  ChatMessage,
  ChatMessagesResponse,
  ConfigRevisionListResponse,
  ContextLogResponse,
  CostsHistogramResponse,
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
  NpmVersionsResponse,
  PinoLogEntry,
  RotateAccessKeyResult,
  RunsDataResponse,
  RunSession,
  SaveModelResponse,
  SaveVariableResponse,
  SendChatRequest,
  SendChatResponse,
  SendMailRequest,
  SendMailResponse,
  ServerLogResponse,
  StatusResponse,
  UpdateAgentConfigResponse,
  VariablesResponse,
} from "@naisys/supervisor-shared";

export const API_BASE = "/supervisor/api";

export type {
  AdminAttachmentListResponse,
  AdminInfoResponse,
  Agent,
  AgentActionResult,
  AgentConfigFile,
  AgentDetailResponse,
  AgentListResponse,
  AgentStartResult,
  AgentStopResult,
  ArchiveChatResponse,
  ArchiveMailResponse,
  AuthUser,
  ChatConversation,
  ChatConversationsResponse,
  ChatMessage,
  ChatMessagesResponse,
  ConfigRevisionListResponse,
  ContextLogResponse,
  CostsHistogramResponse,
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
  NpmVersionsResponse,
  PinoLogEntry,
  RotateAccessKeyResult,
  RunsDataResponse,
  RunSession,
  SaveModelResponse,
  SaveVariableResponse,
  SendChatRequest,
  SendChatResponse,
  SendMailRequest,
  SendMailResponse,
  ServerLogResponse,
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
  agentConfigRevisions: (username: string) =>
    `/agents/${username}/config/revisions`,
  agentRuns: (username: string) => `/agents/${username}/runs`,
  agentMail: (username: string) => `/agents/${username}/mail`,
  agentChat: (username: string) => `/agents/${username}/chat`,
  agentChatMessages: (username: string, participants: string) =>
    `/agents/${username}/chat/${participants}`,
  agentChatArchive: (username: string) => `/agents/${username}/chat/archive`,
  agentMailArchive: (username: string) => `/agents/${username}/mail/archive`,
  agentContextLog: (username: string, runId: number, sessionId: number) =>
    `/agents/${username}/runs/${runId}/sessions/${sessionId}/logs`,
  agentStart: (username: string) => `/agents/${username}/start`,
  agentStop: (username: string) => `/agents/${username}/stop`,
  agentEnable: (username: string) => `/agents/${username}/enable`,
  agentDisable: (username: string) => `/agents/${username}/disable`,
  agentArchive: (username: string) => `/agents/${username}/archive`,
  agentUnarchive: (username: string) => `/agents/${username}/unarchive`,
  agentLead: (username: string) => `/agents/${username}/lead`,
  agentResetSpend: (username: string) => `/agents/${username}/reset-spend`,
  agentDelete: (username: string) => `/agents/${username}`,
  hostDetail: (hostname: string) => `/hosts/${hostname}`,
  hostUpdate: (hostname: string) => `/hosts/${hostname}`,
  hostCreate: "/hosts",
  hostAssignAgent: (hostname: string) => `/hosts/${hostname}/agents`,
  hostUnassignAgent: (hostname: string, agentName: string) =>
    `/hosts/${hostname}/agents/${agentName}`,
  hostDelete: (hostname: string) => `/hosts/${hostname}`,
  models: "/models",
  saveLlmModel: "/models/llm",
  saveImageModel: "/models/image",
  deleteModel: (type: "llm" | "image", key: string) =>
    `/models/${type}/${encodeURIComponent(key)}`,
  variables: "/variables",
  saveVariable: (key: string) => `/variables/${encodeURIComponent(key)}`,
  deleteVariable: (key: string) => `/variables/${encodeURIComponent(key)}`,
  costs: (params?: {
    start?: string;
    end?: string;
    bucketHours?: number;
    leadUsername?: string;
  }) => {
    const search = new URLSearchParams();
    if (params?.start) search.set("start", params.start);
    if (params?.end) search.set("end", params.end);
    if (params?.bucketHours)
      search.set("bucketHours", String(params.bucketHours));
    if (params?.leadUsername) search.set("leadUsername", params.leadUsername);
    const qs = search.toString();
    return `/costs${qs ? `?${qs}` : ""}`;
  },
  attachmentDownload: (id: string, filename?: string) =>
    filename
      ? `/attachments/${id}/${encodeURIComponent(filename)}`
      : `/attachments/${id}`,
  permissions: "/permissions",
  admin: "/admin",
  adminAttachments: "/admin/attachments",
  adminExportConfig: "/admin/export-config",
  adminRotateAccessKey: "/admin/rotate-access-key",
  adminLogs: (file: string, lines?: number, minLevel?: number) =>
    `/admin/logs?file=${file}${lines ? `&lines=${lines}` : ""}${minLevel ? `&minLevel=${minLevel}` : ""}`,
  adminNpmVersions: "/admin/npm-versions",
  adminNpmVersionsCheck: (version: string) =>
    `/admin/npm-versions?check=${encodeURIComponent(version)}`,
  adminTargetVersion: "/admin/target-version",
};

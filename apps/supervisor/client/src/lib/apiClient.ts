import type { AgentConfigFile } from "@naisys/common";
import type {
  AdminAttachmentListResponse,
  AdminInfoResponse,
  Agent,
  AgentActionResult,
  AgentDetailResponse,
  AgentListResponse,
  AgentRunCommandResult,
  AgentRunPauseResult,
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
  LogoutResponse,
  MailDataResponse,
  MailMessage,
  ModelsResponse,
  NpmVersionsResponse,
  PasskeyCredential,
  PasskeyCredentialList,
  PasskeyRegistrationVerifyResponse,
  PinoLogEntry,
  RegistrationTokenResponse,
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
  StepUpOptionsResponse,
  UpdateAgentConfigResponse,
  UserActionResult,
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
  AgentRunCommandResult,
  AgentRunPauseResult,
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
  LogoutResponse,
  MailDataResponse,
  MailMessage,
  ModelsResponse,
  NpmVersionsResponse,
  PasskeyCredential,
  PasskeyCredentialList,
  PasskeyRegistrationVerifyResponse,
  PinoLogEntry,
  RegistrationTokenResponse,
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
  StepUpOptionsResponse,
  UpdateAgentConfigResponse,
  UserActionResult,
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
  passkeyLoginOptions: "/auth/passkey/login-options",
  passkeyLoginVerify: "/auth/passkey/login-verify",
  passkeyRegisterOptions: "/auth/passkey/register-options",
  passkeyRegisterVerify: "/auth/passkey/register-verify",
  passkeyStepUpOptions: "/auth/passkey/stepup-options",
  registrationTokenLookup: (token: string) =>
    `/auth/registration-token/lookup?token=${encodeURIComponent(token)}`,
  logout: "/auth/logout",
  me: "/auth/me",
  users: (params?: { page?: number; pageSize?: number; search?: string }) => {
    const search = new URLSearchParams();
    if (params?.page !== undefined) search.set("page", String(params.page));
    if (params?.pageSize !== undefined)
      search.set("pageSize", String(params.pageSize));
    if (params?.search) search.set("search", params.search);
    const qs = search.toString();
    return `/users${qs ? `?${qs}` : ""}`;
  },
  userCreateFromAgent: "/users/from-agent",
  userDetail: (username: string) => `/users/${username}`,
  userPermissions: (username: string) => `/users/${username}/permissions`,
  userPermission: (username: string, permission: string) =>
    `/users/${username}/permissions/${permission}`,
  userRotateKey: (username: string) => `/users/${username}/rotate-key`,
  userPasskeys: (username: string) => `/users/${username}/passkeys`,
  userPasskeyDelete: (username: string, id: number) =>
    `/users/${username}/passkeys/${id}/delete`,
  userRegistrationToken: (username: string) =>
    `/users/${username}/registration-token`,
  userResetPasskeys: (username: string) => `/users/${username}/reset-passkeys`,
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
  agentRunPause: (username: string, runId: number, sessionId: number) =>
    `/agents/${username}/runs/${runId}/sessions/${sessionId}/pause`,
  agentRunResume: (username: string, runId: number, sessionId: number) =>
    `/agents/${username}/runs/${runId}/sessions/${sessionId}/resume`,
  agentRunCommand: (username: string, runId: number, sessionId: number) =>
    `/agents/${username}/runs/${runId}/sessions/${sessionId}/command`,
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
  hostRuns: (hostname: string) => `/hosts/${hostname}/runs`,
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

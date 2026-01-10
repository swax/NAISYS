import type {
  AccessKeyRequest,
  AccessKeyResponse,
  Agent,
  ContextLogResponse,
  CreateAgentConfigResponse,
  GetAgentConfigResponse,
  LogEntry,
  MailDataResponse,
  MailThreadMessage,
  NaisysDataRequest,
  NaisysDataResponse,
  RunsDataResponse,
  RunSession,
  SendMailRequest,
  SendMailResponse,
  SettingsRequest,
  SettingsResponse,
  UpdateAgentConfigResponse,
} from "shared";

const API_BASE = "/api";

export interface SessionResponse {
  success: boolean;
  username?: string;
  startDate?: string;
  expireDate?: string;
  message?: string;
}

export interface LogoutResponse {
  success: boolean;
  message: string;
}

export type {
  AccessKeyRequest,
  AccessKeyResponse,
  Agent,
  ContextLogResponse,
  CreateAgentConfigResponse,
  GetAgentConfigResponse,
  LogEntry,
  MailDataResponse,
  MailThreadMessage,
  NaisysDataRequest,
  NaisysDataResponse,
  RunsDataResponse,
  RunSession,
  SendMailRequest,
  SendMailResponse,
  SettingsRequest,
  SettingsResponse,
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
};

export const apiEndpoints = {
  accessKey: "/access-key",
  session: "/session",
  logout: "/logout",
  settings: "/settings",
  agent: "/agent",
  agentConfig: "/agent/config",
  sendMail: "/send-mail",
  runs: "/runs",
  contextLog: "/context-log",
  mail: "/mail",
};

export const checkSession = async (): Promise<SessionResponse> => {
  try {
    return await api.get<SessionResponse>(apiEndpoints.session);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Session check failed",
    };
  }
};

export const submitAccessKey = async (
  accessKey: string,
): Promise<AccessKeyResponse> => {
  try {
    return await api.post<AccessKeyRequest, AccessKeyResponse>(
      apiEndpoints.accessKey,
      { accessKey },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Access key submission failed",
    };
  }
};

export const logout = async (): Promise<LogoutResponse> => {
  try {
    return await api.post<{}, LogoutResponse>(apiEndpoints.logout, {});
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Logout failed",
    };
  }
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

export interface AgentDataParams {
  updatedSince?: string;
}

export const getAgentData = async (
  params?: AgentDataParams,
): Promise<NaisysDataResponse> => {
  if (params?.updatedSince) {
    const queryParams = new URLSearchParams();
    queryParams.append("updatedSince", params.updatedSince);
    const url = `${apiEndpoints.agent}?${queryParams.toString()}`;
    return await api.get<NaisysDataResponse>(url);
  }
  return await api.get<NaisysDataResponse>(apiEndpoints.agent);
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
  userId: number;
  updatedSince?: string;
  page?: number;
  count?: number;
}

export const getRunsData = async (
  params: RunsDataParams,
): Promise<RunsDataResponse> => {
  const queryParams = new URLSearchParams();
  queryParams.append("userId", params.userId.toString());
  if (params.updatedSince) {
    queryParams.append("updatedSince", params.updatedSince);
  }
  if (params.page !== undefined) {
    queryParams.append("page", params.page.toString());
  }
  if (params.count !== undefined) {
    queryParams.append("count", params.count.toString());
  }

  const url = `${apiEndpoints.runs}?${queryParams.toString()}`;
  return await api.get<RunsDataResponse>(url);
};

export interface ContextLogParams {
  userId: number;
  runId: number;
  sessionId: number;
  logsAfter?: number;
}

export const getContextLog = async (
  params: ContextLogParams,
): Promise<ContextLogResponse> => {
  const queryParams = new URLSearchParams();
  queryParams.append("userId", params.userId.toString());
  queryParams.append("runId", params.runId.toString());
  queryParams.append("sessionId", params.sessionId.toString());
  if (params.logsAfter !== undefined) {
    queryParams.append("logsAfter", params.logsAfter.toString());
  }

  const url = `${apiEndpoints.contextLog}?${queryParams.toString()}`;
  return await api.get<ContextLogResponse>(url);
};

export interface MailDataParams {
  agentName: string;
  updatedSince?: string;
  page?: number;
  count?: number;
}

export const getMailData = async (
  params: MailDataParams,
): Promise<MailDataResponse> => {
  const queryParams = new URLSearchParams();
  queryParams.append("agentName", params.agentName);
  if (params.updatedSince) {
    queryParams.append("updatedSince", params.updatedSince);
  }
  if (params.page !== undefined) {
    queryParams.append("page", params.page.toString());
  }
  if (params.count !== undefined) {
    queryParams.append("count", params.count.toString());
  }

  const url = `${apiEndpoints.mail}?${queryParams.toString()}`;
  return await api.get<MailDataResponse>(url);
};

export const getAgentConfig = async (
  username: string,
): Promise<GetAgentConfigResponse> => {
  try {
    const queryParams = new URLSearchParams();
    queryParams.append("username", username);
    const url = `${apiEndpoints.agentConfig}?${queryParams.toString()}`;
    return await api.get<GetAgentConfigResponse>(url);
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load agent configuration",
    };
  }
};

export const updateAgentConfig = async (
  username: string,
  config: string,
): Promise<UpdateAgentConfigResponse> => {
  try {
    return await api.put<
      { username: string; config: string },
      UpdateAgentConfigResponse
    >(apiEndpoints.agentConfig, { username, config });
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
      apiEndpoints.agentConfig,
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

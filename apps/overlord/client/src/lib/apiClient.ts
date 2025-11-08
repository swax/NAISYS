import type {
  HelloResponse,
  AccessKeyRequest,
  AccessKeyResponse,
  SettingsRequest,
  SettingsResponse,
  LogEntry,
  Agent,
  NaisysDataResponse,
  NaisysDataRequest,
  ThreadMessage,
  SendMailRequest,
  SendMailResponse,
  RunsDataResponse,
  RunSession,
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
  HelloResponse,
  AccessKeyRequest,
  AccessKeyResponse,
  SettingsRequest,
  SettingsResponse,
  LogEntry,
  Agent,
  NaisysDataResponse,
  NaisysDataRequest,
  ThreadMessage,
  SendMailRequest,
  SendMailResponse,
  RunsDataResponse,
  RunSession,
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
};

export const apiEndpoints = {
  hello: "/hello",
  accessKey: "/access-key",
  session: "/session",
  logout: "/logout",
  settings: "/settings",
  data: "/data",
  sendMail: "/send-mail",
  runs: "/runs",
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

export interface NaisysDataParams {
  logsAfter?: number;
  logsLimit?: number;
  mailAfter?: number;
  mailLimit?: number;
}

export const getNaisysData = async (
  params?: NaisysDataParams,
): Promise<NaisysDataResponse> => {
  const queryParams = new URLSearchParams();
  if (params?.logsAfter !== undefined)
    queryParams.append("logsAfter", params.logsAfter.toString());
  if (params?.logsLimit)
    queryParams.append("logsLimit", params.logsLimit.toString());
  if (params?.mailAfter !== undefined)
    queryParams.append("mailAfter", params.mailAfter.toString());
  if (params?.mailLimit)
    queryParams.append("mailLimit", params.mailLimit.toString());

  const url = queryParams.toString()
    ? `${apiEndpoints.data}?${queryParams.toString()}`
    : apiEndpoints.data;

  return await api.get<NaisysDataResponse>(url);
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
}

export const getRunsData = async (
  params: RunsDataParams,
): Promise<RunsDataResponse> => {
  const queryParams = new URLSearchParams();
  queryParams.append("userId", params.userId.toString());
  if (params.updatedSince) {
    queryParams.append("updatedSince", params.updatedSince);
  }

  const url = `${apiEndpoints.runs}?${queryParams.toString()}`;
  return await api.get<RunsDataResponse>(url);
};

import type {
  AuthUser,
  LoginResponse,
  LogoutResponse,
  SettingsRequest,
  SettingsResponse,
  StatusResponse,
} from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

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

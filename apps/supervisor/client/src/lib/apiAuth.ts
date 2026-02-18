import type {
  AuthUser,
  LoginResponse,
  LogoutResponse,
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

export const getStatus = async (): Promise<StatusResponse> => {
  return await api.get<StatusResponse>(apiEndpoints.status);
};

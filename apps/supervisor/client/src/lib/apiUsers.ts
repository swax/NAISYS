import type {
  CreateUserResponse,
  Permission,
  UserActionResult,
  UserDetailResponse,
  UserListResponse,
} from "@naisys/supervisor-shared";

import { api } from "./apiClient";

export const getUsers = async (params: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<UserListResponse> => {
  const queryParams = new URLSearchParams();
  if (params.page !== undefined) queryParams.set("page", String(params.page));
  if (params.pageSize !== undefined)
    queryParams.set("pageSize", String(params.pageSize));
  if (params.search) queryParams.set("search", params.search);
  return api.get<UserListResponse>(`/users?${queryParams}`);
};

export const getUser = async (
  username: string,
): Promise<UserDetailResponse> => {
  return api.get<UserDetailResponse>(`/users/${username}`);
};

export const createUser = async (data: {
  username: string;
  password: string;
}): Promise<CreateUserResponse> => {
  return api.post<typeof data, CreateUserResponse>("/users", data);
};

export const updateUser = async (
  username: string,
  data: { username?: string },
): Promise<UserActionResult> => {
  return api.put<typeof data, UserActionResult>(`/users/${username}`, data);
};

export const deleteUser = async (
  username: string,
): Promise<UserActionResult> => {
  return api.delete<UserActionResult>(`/users/${username}`);
};

export const grantPermission = async (
  username: string,
  permission: Permission,
): Promise<UserActionResult> => {
  return api.post<{ permission: Permission }, UserActionResult>(
    `/users/${username}/permissions`,
    { permission },
  );
};

export const revokePermission = async (
  username: string,
  permission: Permission,
): Promise<UserActionResult> => {
  return api.delete<UserActionResult>(
    `/users/${username}/permissions/${permission}`,
  );
};

export const changePassword = async (
  password: string,
): Promise<UserActionResult> => {
  return api.post<{ password: string }, UserActionResult>(
    "/users/me/password",
    { password },
  );
};

export const rotateUserApiKey = async (
  username: string,
): Promise<UserActionResult> => {
  return api.post<{}, UserActionResult>(`/users/${username}/rotate-key`, {});
};

export const createAgentUser = async (
  agentId: number,
): Promise<CreateUserResponse> => {
  return api.post<{ agentId: number }, CreateUserResponse>("/users/from-agent", {
    agentId,
  });
};

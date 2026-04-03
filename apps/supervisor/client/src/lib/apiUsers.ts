import type { Permission } from "@naisys/supervisor-shared";

import { api } from "./apiClient";

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

export const getUser = async (username: string): Promise<any> => {
  return api.get(`/users/${username}`);
};

export const createUser = async (data: {
  username: string;
  password: string;
}): Promise<any> => {
  return api.post("/users", data);
};

export const updateUser = async (
  username: string,
  data: { username?: string },
): Promise<any> => {
  return api.put(`/users/${username}`, data);
};

export const deleteUser = async (username: string): Promise<any> => {
  return api.delete(`/users/${username}`);
};

export const grantPermission = async (
  username: string,
  permission: Permission,
): Promise<any> => {
  return api.post(`/users/${username}/permissions`, { permission });
};

export const revokePermission = async (
  username: string,
  permission: Permission,
): Promise<any> => {
  return api.delete(`/users/${username}/permissions/${permission}`);
};

export const changePassword = async (password: string): Promise<any> => {
  return api.post("/users/me/password", { password });
};

export const rotateUserApiKey = async (username: string): Promise<any> => {
  return api.post(`/users/${username}/rotate-key`, {});
};

export const createAgentUser = async (agentId: number): Promise<any> => {
  return api.post("/users/from-agent", { agentId });
};

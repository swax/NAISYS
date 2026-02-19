import { api } from "./apiClient";

/* eslint-disable @typescript-eslint/no-explicit-any */

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

export const getUser = async (id: number): Promise<any> => {
  return api.get(`/users/${id}`);
};

export const createUser = async (data: {
  username: string;
  password: string;
  authType?: string;
}): Promise<any> => {
  return api.post("/users", data);
};

export const updateUser = async (
  id: number,
  data: { username?: string },
): Promise<any> => {
  return api.put(`/users/${id}`, data);
};

export const deleteUser = async (id: number): Promise<any> => {
  return api.delete(`/users/${id}`);
};

export const grantPermission = async (
  userId: number,
  permission: string,
): Promise<any> => {
  return api.post(`/users/${userId}/permissions`, { permission });
};

export const revokePermission = async (
  userId: number,
  permission: string,
): Promise<any> => {
  return api.delete(`/users/${userId}/permissions/${permission}`);
};

export const changePassword = async (password: string): Promise<any> => {
  return api.post("/users/me/password", { password });
};

import { notifications } from "@mantine/notifications";
import type { AuthUser, LoginResponse } from "@naisys-erp/shared";

const API_BASE = "/api/erp";

export class ApiError extends Error {
  statusCode: number;
  error: string;

  constructor(statusCode: number, error: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.error = error;
  }
}

export function showErrorNotification(err: unknown) {
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred";
  notifications.show({
    title: "Error",
    message,
    color: "red",
    autoClose: 5000,
  });
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith("/") ? path : `${API_BASE}/${path}`;
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("erp:unauthorized"));
  }

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(
      data.statusCode ?? res.status,
      data.error ?? "Error",
      data.message || `Request failed: ${res.status}`,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),

  delete: (path: string) => request<void>(path, { method: "DELETE" }),
};

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/api/erp/auth/login", { username, password }),

  logout: () => api.post<{ ok: boolean }>("/api/erp/auth/logout", {}),

  me: () => api.get<AuthUser>("/api/erp/auth/me"),
};

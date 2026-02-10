import { notifications } from "@mantine/notifications";

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
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

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

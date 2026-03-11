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
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers,
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

export const apiEndpoints = {
  orders: "orders",
  order: (key: string) => `orders/${key}`,
  orderRevs: (key: string) => `orders/${key}/revs`,
  orderRev: (key: string, revNo: number | string) =>
    `orders/${key}/revs/${revNo}`,
  orderRevApprove: (key: string, revNo: number | string) =>
    `orders/${key}/revs/${revNo}/approve`,
  orderRevObsolete: (key: string, revNo: number | string) =>
    `orders/${key}/revs/${revNo}/obsolete`,
  orderRevOps: (key: string, revNo: number | string) =>
    `orders/${key}/revs/${revNo}/ops`,
  orderRevOp: (key: string, revNo: number | string, seqNo: number | string) =>
    `orders/${key}/revs/${revNo}/ops/${seqNo}`,
  orderRevOpSteps: (
    key: string,
    revNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/revs/${revNo}/ops/${seqNo}/steps`,
  orderRevOpStep: (
    key: string,
    revNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
  ) => `orders/${key}/revs/${revNo}/ops/${seqNo}/steps/${stepSeqNo}`,
  orderRevOpStepFields: (
    key: string,
    revNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
  ) => `orders/${key}/revs/${revNo}/ops/${seqNo}/steps/${stepSeqNo}/fields`,
  orderRevOpStepField: (
    key: string,
    revNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
    fieldSeqNo: number | string,
  ) =>
    `orders/${key}/revs/${revNo}/ops/${seqNo}/steps/${stepSeqNo}/fields/${fieldSeqNo}`,
  orderRuns: (key: string) => `orders/${key}/runs`,
  orderRun: (key: string, id: number | string) => `orders/${key}/runs/${id}`,
  orderRunStart: (key: string, id: number | string) =>
    `orders/${key}/runs/${id}/start`,
  orderRunClose: (key: string, id: number | string) =>
    `orders/${key}/runs/${id}/close`,
  orderRunCancel: (key: string, id: number | string) =>
    `orders/${key}/runs/${id}/cancel`,
  users: "users",
  user: (username: string) => `users/${username}`,
  userPermissions: (username: string) => `users/${username}/permissions`,
  userPermission: (username: string, perm: string) =>
    `users/${username}/permissions/${perm}`,
  userRotateKey: (username: string) => `users/${username}/rotate-key`,
  changePassword: "users/me/password",
  audit: (entityType: string, entityId: number | string) =>
    `audit?entityType=${entityType}&entityId=${entityId}`,
};

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/api/erp/auth/login", { username, password }),

  logout: () => api.post<{ ok: boolean }>("/api/erp/auth/logout", {}),

  me: () => api.get<AuthUser>("/api/erp/auth/me"),
};

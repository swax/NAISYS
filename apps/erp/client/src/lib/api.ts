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

  /** Upload a file via multipart/form-data */
  upload: <T>(
    path: string,
    file: File,
    extraFields?: Record<string, string>,
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        formData.append(key, value);
      }
    }
    const url = path.startsWith("/") ? path : `${API_BASE}/${path}`;
    return fetch(url, {
      method: "POST",
      credentials: "include",
      body: formData,
      // No Content-Type header — browser sets it with boundary
    }).then(async (res) => {
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent("erp:unauthorized"));
      }
      const data = await res.json();
      if (!res.ok) {
        throw new ApiError(
          data.statusCode ?? res.status,
          data.error ?? "Error",
          data.message || `Upload failed: ${res.status}`,
        );
      }
      return data as T;
    });
  },
};

export const apiEndpoints = {
  dispatch: "dispatch",
  inventory: "inventory",
  items: "items",
  item: (key: string) => `items/${key}`,
  itemFields: (key: string) => `items/${key}/fields`,
  itemField: (key: string, fieldSeqNo: number | string) =>
    `items/${key}/fields/${fieldSeqNo}`,
  itemInstances: (key: string) => `items/${key}/instances`,
  itemInstance: (key: string, instanceId: number | string) =>
    `items/${key}/instances/${instanceId}`,
  itemInstanceFieldValue: (
    key: string,
    instanceId: number | string,
    fieldSeqNo: number | string,
  ) => `items/${key}/instances/${instanceId}/fields/${fieldSeqNo}`,
  itemInstanceDeleteSet: (
    key: string,
    instanceId: number | string,
    setIndex: number,
  ) => `items/${key}/instances/${instanceId}/sets/${setIndex}`,
  orders: "orders",
  order: (key: string) => `orders/${key}`,
  orderRevs: (key: string) => `orders/${key}/revs`,
  orderRev: (key: string, revNo: number | string) =>
    `orders/${key}/revs/${revNo}`,
  orderRevDiff: (key: string, fromRevNo: number | string, toRevNo: number | string) =>
    `orders/${key}/revs/diff?from=${fromRevNo}&to=${toRevNo}`,
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
  orderRevOpDeps: (
    key: string,
    revNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/revs/${revNo}/ops/${seqNo}/deps`,
  orderRevOpDep: (
    key: string,
    revNo: number | string,
    seqNo: number | string,
    predecessorSeqNo: number | string,
  ) => `orders/${key}/revs/${revNo}/ops/${seqNo}/deps/${predecessorSeqNo}`,
  orderRuns: (key: string) => `orders/${key}/runs`,
  orderRun: (key: string, runNo: number | string) =>
    `orders/${key}/runs/${runNo}`,
  orderRunStart: (key: string, runNo: number | string) =>
    `orders/${key}/runs/${runNo}/start`,
  orderRunClose: (key: string, runNo: number | string) =>
    `orders/${key}/runs/${runNo}/close`,
  orderRunCancel: (key: string, runNo: number | string) =>
    `orders/${key}/runs/${runNo}/cancel`,
  orderRunComplete: (key: string, runNo: number | string) =>
    `orders/${key}/runs/${runNo}/complete`,
  orderRunReopen: (key: string, runNo: number | string) =>
    `orders/${key}/runs/${runNo}/reopen`,
  users: "users",
  user: (username: string) => `users/${username}`,
  userPermissions: (username: string) => `users/${username}/permissions`,
  userPermission: (username: string, perm: string) =>
    `users/${username}/permissions/${perm}`,
  operationRuns: (key: string, runNo: number | string) =>
    `orders/${key}/runs/${runNo}/ops`,
  operationRun: (key: string, runNo: number | string, seqNo: number | string) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}`,
  operationRunStart: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/start`,
  operationRunComplete: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/complete`,
  operationRunSkip: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/skip`,
  operationRunFail: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/fail`,
  operationRunReopen: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/reopen`,
  stepRuns: (key: string, runNo: number | string, seqNo: number | string) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/steps`,
  stepRun: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/steps/${stepSeqNo}`,
  stepRunFieldValue: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
    fieldSeqNo: number | string,
  ) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/steps/${stepSeqNo}/fields/${fieldSeqNo}`,
  stepRunSetFieldValue: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
    setIndex: number | string,
    fieldSeqNo: number | string,
  ) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/steps/${stepSeqNo}/sets/${setIndex}/fields/${fieldSeqNo}`,
  stepRunDeleteSet: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
    setIndex: number,
  ) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/steps/${stepSeqNo}/sets/${setIndex}`,
  stepFieldAttachments: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
    fieldSeqNo: number | string,
  ) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/steps/${stepSeqNo}/fields/${fieldSeqNo}/attachments`,
  stepFieldSetAttachments: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
    setIndex: number | string,
    fieldSeqNo: number | string,
  ) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/steps/${stepSeqNo}/sets/${setIndex}/fields/${fieldSeqNo}/attachments`,
  stepFieldAttachmentDownload: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    stepSeqNo: number | string,
    fieldSeqNo: number | string,
    attachmentId: number | string,
  ) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/steps/${stepSeqNo}/fields/${fieldSeqNo}/attachments/${attachmentId}`,
  laborTickets: (key: string, runNo: number | string, seqNo: number | string) =>
    `orders/${key}/runs/${runNo}/ops/${seqNo}/labor`,
  laborTicketClockIn: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/labor/clock-in`,
  laborTicketClockOut: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/labor/clock-out`,
  laborTicket: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
    ticketId: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/labor/${ticketId}`,
  operationRunComments: (
    key: string,
    runNo: number | string,
    seqNo: number | string,
  ) => `orders/${key}/runs/${runNo}/ops/${seqNo}/comments`,
  workCenters: "work-centers",
  workCenter: (key: string) => `work-centers/${key}`,
  workCenterUsers: (key: string) => `work-centers/${key}/users`,
  workCenterUser: (key: string, username: string) =>
    `work-centers/${key}/users/${username}`,
  usersFromAgent: "users/from-agent",
  userRotateKey: (username: string) => `users/${username}/rotate-key`,
  changePassword: "users/me/password",
  audit: (entityType: string, entityId: number | string) =>
    `audit?entityType=${entityType}&entityId=${entityId}`,
  admin: "admin",
  adminAttachments: "admin/attachments",
  adminAttachmentDownload: (id: number | string) =>
    `/api/erp/admin/attachments/${id}`,
  adminLogs: (lines?: number, minLevel?: number) => {
    const params = new URLSearchParams();
    if (lines != null) params.set("lines", String(lines));
    if (minLevel != null) params.set("minLevel", String(minLevel));
    const qs = params.toString();
    return `admin/logs${qs ? `?${qs}` : ""}`;
  },
};

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/api/erp/auth/login", { username, password }),

  logout: () => api.post<{ ok: boolean }>("/api/erp/auth/logout", {}),

  me: () => api.get<AuthUser>("/api/erp/auth/me"),
};

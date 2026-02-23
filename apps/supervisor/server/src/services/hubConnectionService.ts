import { parseHubAccessKey, verifyHubCertificate } from "@naisys/common-node";
import { io, Socket } from "socket.io-client";
import {
  AgentStartResponse,
  AgentStopResponse,
  AgentsStatusSchema,
  HostListSchema,
  HubEvents,
  MailSendResponse,
} from "@naisys/hub-protocol";
import {
  emitListChanged,
  markAgentStarted,
  markAgentStopped,
  updateAgentsStatus,
  updateHostsStatus,
} from "./agentHostStatusService.js";

let socket: Socket | null = null;
let connected = false;
let resolvedHubAccessKey: string | undefined;
let resolvedHubUrl: string | undefined;

export function initHubConnection(hubUrl: string, hubAccessKey?: string) {
  hubAccessKey = hubAccessKey || process.env.HUB_ACCESS_KEY;
  resolvedHubAccessKey = hubAccessKey;
  resolvedHubUrl = hubUrl;

  if (!hubAccessKey) {
    console.warn(
      "[Supervisor:HubClient] HUB_ACCESS_KEY not set, skipping hub connection",
    );
    return;
  }

  console.log(`[Supervisor:HubClient] Connecting to ${hubUrl}...`);

  // Verify the hub's TLS certificate fingerprint matches the access key
  const { fingerprintPrefix } = parseHubAccessKey(hubAccessKey);
  const url = new URL(hubUrl);
  verifyHubCertificate(url.hostname, Number(url.port) || 443, fingerprintPrefix)
    .then(() => connectSocket(hubUrl, hubAccessKey!))
    .catch((err) => {
      console.error(
        `[Supervisor:HubClient] Certificate verification failed: ${err.message}`,
      );
    });
}

function connectSocket(hubUrl: string, hubAccessKey: string) {
  socket = io(hubUrl + "/naisys", {
    auth: {
      hubAccessKey,
      hostName: "SUPERVISOR",
      canRunAgents: false,
    },
    rejectUnauthorized: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
  });

  socket.on("connect", () => {
    connected = true;
    console.log(`[Supervisor:HubClient] Connected to ${hubUrl}`);
  });

  socket.on("disconnect", (reason) => {
    connected = false;
    console.log(`[Supervisor:HubClient] Disconnected: ${reason}`);
  });

  socket.on("connect_error", (error) => {
    console.warn(`[Supervisor:HubClient] Connection error: ${error.message}`);
  });

  socket.on(HubEvents.AGENTS_STATUS, (data: unknown) => {
    const parsed = AgentsStatusSchema.safeParse(data);
    if (!parsed.success) {
      console.warn(
        "[Supervisor:HubClient] Invalid agents status:",
        parsed.error,
      );
      return;
    }

    updateAgentsStatus(
      parsed.data.hostActiveAgents,
      parsed.data.agentNotifications,
    );
  });

  socket.on(HubEvents.HOSTS_UPDATED, (data: unknown) => {
    const parsed = HostListSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[Supervisor:HubClient] Invalid host list:", parsed.error);
      return;
    }

    updateHostsStatus(parsed.data.hosts);
  });

  // User list changed (hub broadcasts after create/edit/archive/delete)
  socket.on(HubEvents.USERS_UPDATED, () => {
    emitListChanged();
  });
}

export function isHubConnected(): boolean {
  return connected;
}

export function getHubAccessKey(): string | undefined {
  return resolvedHubAccessKey;
}

export function getHubUrl(): string | undefined {
  return resolvedHubUrl;
}

export function sendAgentStart(
  startUserId: number,
  taskDescription: string | undefined,
  requesterUserId: number,
): Promise<AgentStartResponse> {
  return new Promise((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(
      HubEvents.AGENT_START,
      { startUserId, taskDescription, requesterUserId },
      (response: AgentStartResponse) => {
        if (response.success) {
          markAgentStarted(startUserId);
        }
        resolve(response);
      },
    );
  });
}

export function sendMailViaHub(
  fromUserId: number,
  toUserIds: number[],
  subject: string,
  body: string,
  kind: "mail" | "chat" = "mail",
  attachmentIds?: number[],
): Promise<MailSendResponse> {
  return new Promise((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(
      HubEvents.MAIL_SEND,
      { fromUserId, toUserIds, subject, body, kind, attachmentIds },
      (response: MailSendResponse) => {
        resolve(response);
      },
    );
  });
}

export function sendUserListChanged(): void {
  if (!socket || !connected) {
    console.warn(
      "[Supervisor:HubClient] Not connected to hub, cannot send user list changed",
    );
    return;
  }

  socket.emit(HubEvents.USERS_CHANGED);
}

export function sendModelsChanged(): void {
  if (!socket || !connected) {
    console.warn(
      "[Supervisor:HubClient] Not connected to hub, cannot send models changed",
    );
    return;
  }

  socket.emit(HubEvents.MODELS_CHANGED);
}

export function sendVariablesChanged(): void {
  if (!socket || !connected) {
    console.warn(
      "[Supervisor:HubClient] Not connected to hub, cannot send variables changed",
    );
    return;
  }

  socket.emit(HubEvents.VARIABLES_CHANGED);
}

export function sendAgentStop(
  userId: number,
  reason: string,
): Promise<AgentStopResponse> {
  return new Promise((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(
      HubEvents.AGENT_STOP,
      { userId, reason },
      (response: AgentStopResponse) => {
        if (response.success) {
          markAgentStopped(userId);
        }
        resolve(response);
      },
    );
  });
}

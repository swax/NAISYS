import { EventEmitter } from "node:events";
import { io, Socket } from "socket.io-client";
import {
  AgentStartResponse,
  AgentStopResponse,
  HeartbeatStatusSchema,
  HostListSchema,
  HubEvents,
  MailSendResponse,
} from "@naisys/hub-protocol";
import type { AgentStatusEvent } from "@naisys-supervisor/shared";

let socket: Socket | null = null;
let connected = false;
const activeAgentIds = new Set<number>();
const connectedHostIds = new Set<number>();
const agentNotifications = new Map<
  number,
  { latestLogId: number; latestMailId: number }
>();
const hostOnlineStatus = new Map<number, boolean>();

const statusEmitter = new EventEmitter();

export function initHubConnection(hubUrl: string) {
  const accessKey = process.env.HUB_ACCESS_KEY;

  if (!accessKey) {
    console.warn(
      "[Supervisor:HubClient] HUB_ACCESS_KEY not set, skipping hub connection",
    );
    return;
  }

  console.log(`[Supervisor:HubClient] Connecting to ${hubUrl}...`);

  socket = io(hubUrl + "/naisys", {
    auth: {
      accessKey,
      hostName: "SUPERVISOR",
      canRunAgents: false,
    },
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

  socket.on(HubEvents.HEARTBEAT_STATUS, (data: unknown) => {
    const parsed = HeartbeatStatusSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[Supervisor:HubClient] Invalid heartbeat status:", parsed.error);
      return;
    }

    activeAgentIds.clear();
    connectedHostIds.clear();
    for (const [hostId, userIds] of Object.entries(
      parsed.data.hostActiveAgents,
    )) {
      connectedHostIds.add(Number(hostId));
      for (const id of userIds) {
        activeAgentIds.add(id);
      }
    }

    // Update agentNotifications from heartbeat data
    if (parsed.data.agentNotifications) {
      for (const [key, value] of Object.entries(
        parsed.data.agentNotifications,
      )) {
        agentNotifications.set(Number(key), value);
      }
    }

    // Emit status update for SSE listeners
    statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
  });

  socket.on(HubEvents.HOST_LIST, (data: unknown) => {
    const parsed = HostListSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[Supervisor:HubClient] Invalid host list:", parsed.error);
      return;
    }

    hostOnlineStatus.clear();
    connectedHostIds.clear();
    for (const host of parsed.data.hosts) {
      hostOnlineStatus.set(host.hostId, host.online);
      if (host.online) {
        connectedHostIds.add(host.hostId);
      }
    }

    // Emit status update for SSE listeners
    statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
  });

  // User list changed (hub broadcasts after create/edit/archive/delete)
  socket.on(HubEvents.USER_LIST, () => {
    statusEmitter.emit("agentStatusUpdate", {
      ...getAgentStatusSnapshot(),
      listChanged: true,
    });
  });
}

export function isHubConnected(): boolean {
  return connected;
}

export function isAgentActive(userId: number): boolean {
  return activeAgentIds.has(userId);
}

export function isHostConnected(hostId: number): boolean {
  return connectedHostIds.has(hostId);
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
          activeAgentIds.add(startUserId);
          statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
        }
        resolve(response);
      },
    );
  });
}

/** Build a snapshot of all agent statuses from current state */
export function getAgentStatusSnapshot(): AgentStatusEvent {
  const agents: AgentStatusEvent["agents"] = {};

  // Include all agents we know about from notifications
  for (const [userId, notif] of agentNotifications) {
    agents[String(userId)] = {
      online: activeAgentIds.has(userId),
      latestLogId: notif.latestLogId,
      latestMailId: notif.latestMailId,
    };
  }

  // Include active agents that may not have notifications yet
  for (const userId of activeAgentIds) {
    if (!agents[String(userId)]) {
      agents[String(userId)] = {
        online: true,
        latestLogId: 0,
        latestMailId: 0,
      };
    }
  }

  const hosts: NonNullable<AgentStatusEvent["hosts"]> = {};
  for (const [hostId, online] of hostOnlineStatus) {
    hosts[String(hostId)] = { online };
  }

  return { agents, hosts };
}

/** Subscribe to agent status updates. Returns an unsubscribe function. */
export function onAgentStatusUpdate(
  listener: (event: AgentStatusEvent) => void,
): () => void {
  statusEmitter.on("agentStatusUpdate", listener);
  return () => {
    statusEmitter.off("agentStatusUpdate", listener);
  };
}

export function sendMailViaHub(
  fromUserId: number,
  toUserIds: number[],
  subject: string,
  body: string,
): Promise<MailSendResponse> {
  return new Promise((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(
      HubEvents.MAIL_SEND,
      { fromUserId, toUserIds, subject, body },
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

  socket.emit(HubEvents.USER_LIST_CHANGED);
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
          activeAgentIds.delete(userId);
          statusEmitter.emit("agentStatusUpdate", getAgentStatusSnapshot());
        }
        resolve(response);
      },
    );
  });
}

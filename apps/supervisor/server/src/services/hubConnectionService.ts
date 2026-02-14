import { EventEmitter } from "node:events";
import { io, Socket } from "socket.io-client";
import {
  AgentStartResponse,
  AgentStopResponse,
  HeartbeatStatusSchema,
  HubEvents,
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

const statusEmitter = new EventEmitter();

export function initHubConnection(hubUrl: string) {
  const accessKey = process.env.HUB_ACCESS_KEY;

  if (!accessKey) {
    console.warn("[HubConnection] HUB_ACCESS_KEY not set, skipping hub connection");
    return;
  }

  console.log(`[HubConnection] Connecting to ${hubUrl}...`);

  socket = io(hubUrl + "/naisys", {
    auth: {
      accessKey,
      hostName: "supervisor",
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
  });

  socket.on("connect", () => {
    connected = true;
    console.log(`[HubConnection] Connected to ${hubUrl}`);
  });

  socket.on("disconnect", (reason) => {
    connected = false;
    console.log(`[HubConnection] Disconnected: ${reason}`);
  });

  socket.on("connect_error", (error) => {
    console.warn(`[HubConnection] Connection error: ${error.message}`);
  });

  socket.on(HubEvents.HEARTBEAT_STATUS, (data: unknown) => {
    const parsed = HeartbeatStatusSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[HubConnection] Invalid heartbeat status:", parsed.error);
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
  userId: number,
  taskDescription: string,
): Promise<AgentStartResponse> {
  return new Promise((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(
      HubEvents.AGENT_START,
      { userId, taskDescription },
      (response: AgentStartResponse) => {
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

  return { agents };
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
        resolve(response);
      },
    );
  });
}

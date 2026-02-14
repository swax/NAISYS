import { io, Socket } from "socket.io-client";
import {
  AgentStartResponse,
  AgentStopResponse,
  HeartbeatStatusSchema,
  HubEvents,
} from "@naisys/hub-protocol";

let socket: Socket | null = null;
let connected = false;
const activeAgentIds = new Set<number>();

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
    for (const userIds of Object.values(parsed.data.hostActiveAgents)) {
      for (const id of userIds) {
        activeAgentIds.add(id);
      }
    }
  });
}

export function isHubConnected(): boolean {
  return connected;
}

export function isAgentActive(userId: number): boolean {
  return activeAgentIds.has(userId);
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

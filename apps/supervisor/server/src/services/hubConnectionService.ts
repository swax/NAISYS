import {
  parseHubAccessKey,
  resolveHubAccessKey,
  verifyHubCertificate,
} from "@naisys/common-node";
import type {
  AgentStartResponse,
  AgentStopResponse,
  MailSendResponse,
  RotateAccessKeyResponse,
  SupervisorEmitEvents,
  SupervisorListenEvents,
} from "@naisys/hub-protocol";
import {
  AgentsStatusSchema,
  CostPushSchema,
  HostListSchema,
  HubEvents,
  LogPushSchema,
  MailPushSchema,
  MailReadPushSchema,
  SessionPushSchema,
} from "@naisys/hub-protocol";
import { io, Socket } from "socket.io-client";

import {
  emitAgentsListChanged,
  emitHubConnectionStatus,
  markAgentStarted,
  markAgentStopped,
  updateAgentsStatus,
  updateHostsStatus,
} from "./agentHostStatusService.js";
import { refreshUserLookup, resolveUsername } from "./agentService.js";
import { getIO } from "./browserSocketService.js";

let socket: Socket<SupervisorListenEvents, SupervisorEmitEvents> | null = null;
let connected = false;
let resolvedHubUrl: string | undefined;

export function initHubConnection(hubUrl: string) {
  const hubAccessKey = resolveHubAccessKey();
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
    .then(() => connectSocket(hubUrl))
    .catch((err) => {
      console.error(
        `[Supervisor:HubClient] Certificate verification failed: ${err.message}`,
      );
    });
}

function connectSocket(hubUrl: string) {
  socket = io(hubUrl + "/naisys", {
    auth: (cb) => {
      // Re-read access key on each connection attempt so rotated keys are picked up
      cb({
        hubAccessKey: resolveHubAccessKey(),
        hostName: "SUPERVISOR",
        hostType: "supervisor",
      });
    },
    rejectUnauthorized: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
  });

  socket.on("connect", () => {
    connected = true;
    console.log(`[Supervisor:HubClient] Connected to ${hubUrl}`);
    void refreshUserLookup();
    emitHubConnectionStatus(true);
  });

  socket.on("disconnect", (reason) => {
    connected = false;
    console.log(`[Supervisor:HubClient] Disconnected: ${reason}`);
    emitHubConnectionStatus(false);

    // Server-initiated disconnects don't auto-reconnect in Socket.IO
    if (reason === "io server disconnect") {
      socket?.connect();
    }
  });

  socket.on("connect_error", (error) => {
    console.warn(`[Supervisor:HubClient] Connection error: ${error.message}`);
  });

  socket.on(HubEvents.AGENTS_STATUS, (data) => {
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

  socket.on(HubEvents.HOSTS_UPDATED, (data) => {
    const parsed = HostListSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[Supervisor:HubClient] Invalid host list:", parsed.error);
      return;
    }

    updateHostsStatus(parsed.data.hosts);
  });

  socket.on(HubEvents.LOG_PUSH, (data) => {
    const parsed = LogPushSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[Supervisor:HubClient] Invalid log push:", parsed.error);
      return;
    }

    const browserIO = getIO();

    // Group log entries by session and emit to log rooms
    const bySession = new Map<string, typeof parsed.data.entries>();
    for (const entry of parsed.data.entries) {
      const username = resolveUsername(entry.userId);
      if (!username) continue;
      const room = `logs:${username}:${entry.runId}:${entry.sessionId}`;
      if (!bySession.has(room)) bySession.set(room, []);
      bySession.get(room)!.push(entry);
    }
    for (const [room, entries] of bySession) {
      browserIO.to(room).emit(room, entries);
    }

    // Emit session deltas to runs rooms
    for (const update of parsed.data.sessionUpdates) {
      const username = resolveUsername(update.userId);
      if (!username) continue;
      const room = `runs:${username}`;
      browserIO.to(room).emit(room, { type: "log-update", ...update });
    }
  });

  socket.on(HubEvents.COST_PUSH, (data) => {
    const parsed = CostPushSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[Supervisor:HubClient] Invalid cost push:", parsed.error);
      return;
    }

    const browserIO = getIO();
    for (const entry of parsed.data.entries) {
      const username = resolveUsername(entry.userId);
      if (!username) continue;
      const room = `runs:${username}`;
      browserIO.to(room).emit(room, { type: "cost-update", ...entry });
    }
  });

  socket.on(HubEvents.SESSION_PUSH, (data) => {
    const parsed = SessionPushSchema.safeParse(data);
    if (!parsed.success) {
      console.warn(
        "[Supervisor:HubClient] Invalid session push:",
        parsed.error,
      );
      return;
    }

    const { session } = parsed.data;
    const username = resolveUsername(session.userId);
    if (!username) return;

    const browserIO = getIO();
    const room = `runs:${username}`;
    browserIO.to(room).emit(room, { type: "new-session", ...session });
  });

  socket.on(HubEvents.MAIL_PUSH, (data) => {
    const parsed = MailPushSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[Supervisor:HubClient] Invalid mail push:", parsed.error);
      return;
    }

    const msg = parsed.data;
    const payload = { type: "new-message" as const, ...msg };
    const affectedUserIds = new Set([...msg.recipientUserIds, msg.fromUserId]);
    const browserIO = getIO();

    if (msg.kind === "mail") {
      for (const uid of affectedUserIds) {
        const username = resolveUsername(uid);
        if (!username) continue;
        const room = `mail:${username}`;
        browserIO.to(room).emit(room, payload);
      }
    } else if (msg.kind === "chat") {
      // Chat messages — room keyed by participantIds (unchanged, not user-specific)
      const msgRoom = `chat-messages:${msg.participantIds}`;
      browserIO.to(msgRoom).emit(msgRoom, payload);

      // Chat conversations — rooms keyed by username
      for (const uid of affectedUserIds) {
        const username = resolveUsername(uid);
        if (!username) continue;
        const convRoom = `chat-conversations:${username}`;
        browserIO.to(convRoom).emit(convRoom, payload);
      }
    }
  });

  socket.on(HubEvents.MAIL_READ_PUSH, (data) => {
    const parsed = MailReadPushSchema.safeParse(data);
    if (!parsed.success) {
      console.warn(
        "[Supervisor:HubClient] Invalid mail read push:",
        parsed.error,
      );
      return;
    }

    const msg = parsed.data;
    const receipt = {
      type: "read-receipt" as const,
      messageIds: msg.messageIds,
      userId: msg.userId,
    };

    if (msg.kind === "mail") {
      // Collect all unique participant user IDs
      const participantUserIds = new Set(
        msg.participantIds
          .map((pid) => pid.split(",").map((id) => Number(id)))
          .flat(),
      );

      const browserIO = getIO();
      for (const uid of participantUserIds) {
        const username = resolveUsername(uid);
        if (!username) continue;
        const room = `mail:${username}`;
        browserIO.to(room).emit(room, receipt);
      }
    } else if (msg.kind === "chat") {
      // participantIds here is like the name of the room (unchanged)
      const browserIO = getIO();
      for (const pids of msg.participantIds) {
        const room = `chat-messages:${pids}`;
        browserIO.to(room).emit(room, receipt);
      }
    }
  });

  // User list changed (hub broadcasts after create/edit/archive/delete)
  socket.on(HubEvents.USERS_UPDATED, () => {
    void refreshUserLookup();
    emitAgentsListChanged();
  });
}

export function isHubConnected(): boolean {
  return connected;
}

export function getHubAccessKey(): string | undefined {
  return resolveHubAccessKey();
}

export function getHubUrl(): string | undefined {
  return resolvedHubUrl;
}

export function sendAgentStart(
  startUserId: number,
  taskDescription: string | undefined,
  requesterUserId: number,
) {
  return new Promise<AgentStartResponse>((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(
      HubEvents.AGENT_START,
      { startUserId, taskDescription, requesterUserId },
      (response) => {
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
) {
  return new Promise<MailSendResponse>((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(
      HubEvents.MAIL_SEND,
      { fromUserId, toUserIds, subject, body, kind, attachmentIds },
      (response) => {
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

export function sendHostsChanged(): void {
  if (!socket || !connected) {
    console.warn(
      "[Supervisor:HubClient] Not connected to hub, cannot send hosts changed",
    );
    return;
  }

  socket.emit(HubEvents.HOSTS_CHANGED);
}

export function sendRotateAccessKey() {
  return new Promise<RotateAccessKeyResponse>((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(HubEvents.ROTATE_ACCESS_KEY, {}, (response) => {
      resolve(response);
    });
  });
}

export function sendAgentStop(userId: number, reason: string) {
  return new Promise<AgentStopResponse>((resolve, reject) => {
    if (!socket || !connected) {
      reject(new Error("Not connected to hub"));
      return;
    }

    socket.emit(HubEvents.AGENT_STOP, { userId, reason }, (response) => {
      if (response.success) {
        markAgentStopped(userId);
      }
      resolve(response);
    });
  });
}

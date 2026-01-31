import { Socket } from "socket.io";
import { HubServerLog } from "./hubServerLog.js";

export interface HostConnectionInfo {
  hostId: string;
  hostName: string;
  connectedAt: Date;
}

/** Generic raise event function type - all events have hostId as first arg */
export type RaiseEventFn = (
  event: string,
  hostId: string,
  ...args: unknown[]
) => void;

/**
 * Handles the lifecycle of a single NAISYS instance connection to the hub.
 * Each connected NAISYS instance gets its own NaisysConnection instance.
 */
export function createNaisysConnection(
  socket: Socket,
  connectionInfo: HostConnectionInfo,
  raiseEvent: RaiseEventFn,
  logService: HubServerLog,
) {
  const { hostId, hostName, connectedAt } = connectionInfo;

  logService.log(
    `[NaisysConnection] NAISYS instance connected: ${hostName} (${hostId})`,
  );

  // Forward all socket events to hub's emit function
  // Note: Socket.IO passes (eventName, ...args) where last arg may be an ack callback
  socket.onAny((eventName: string, ...args: unknown[]) => {
    logService.log(
      `[NaisysConnection] Received ${eventName} from ${hostName}`,
    );
    // Pass all args including any ack callback (usually data and optional ack)
    raiseEvent(eventName, hostId, ...args);
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    logService.log(
      `[NaisysConnection] NAISYS instance disconnected: ${hostName} (${hostId}) - ${reason}`,
    );
  });

  /** Callback type for acknowledgements */
  type AckCallback<T = unknown> = (response: T) => void;

  /**
   * Send a message to this client's socket.
   * If ack callback is provided, waits for client acknowledgement.
   */
  function sendMessage<T = unknown>(
    event: string,
    payload: unknown,
    ack?: AckCallback<T>,
  ) {
    if (ack) {
      socket.emit(event, payload, ack);
    } else {
      socket.emit(event, payload);
    }
  }

  return {
    sendMessage,
    getHostId: () => hostId,
    getHostName: () => hostName,
    getConnectedAt: () => connectedAt,
    getSocketId: () => socket.id,
  };
}

export type NaisysConnection = ReturnType<typeof createNaisysConnection>;

import type { DualLogger } from "@naisys/common-node";
import type { Socket } from "socket.io";

export interface HostConnectionInfo {
  hostId: number;
  hostName: string;
  connectedAt: Date;
  hostType: string;
  clientVersion: string;
}

/** Generic raise event function type - all events have hostId as first arg */
export type RaiseEventFn = (
  event: string,
  hostId: number,
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
  logService: DualLogger,
) {
  const { hostId, hostName, connectedAt, hostType, clientVersion } =
    connectionInfo;

  logService.log(
    `[Hub:Connection] NAISYS instance connected: ${hostName} (${hostId})`,
  );

  // Forward all socket events to hub's emit function
  // Note: Socket.IO passes (eventName, ...args) where last arg may be an ack callback
  socket.onAny((eventName: string, ...args: unknown[]) => {
    logService.log(`[Hub:Connection] Received ${eventName} from ${hostName}`);
    // Pass all args including any ack callback (usually data and optional ack)
    raiseEvent(eventName, hostId, ...args);
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    logService.log(
      `[Hub:Connection] NAISYS instance disconnected: ${hostName} (${hostId}) - ${reason}`,
    );
  });

  /** Callback type for acknowledgements */
  type AckCallback<T = unknown> = (response: T) => void;

  /**
   * Send a message to this client's socket.
   * If ack callback is provided, waits for client acknowledgement.
   */
  function sendMessage<P, T = unknown>(
    event: string,
    payload: P,
    ack?: AckCallback<T>,
  ) {
    if (ack) {
      socket.emit(event, payload, ack);
    } else {
      socket.emit(event, payload);
    }
  }

  /** Forcefully disconnect this client */
  function disconnect() {
    socket.disconnect(true);
  }

  return {
    sendMessage,
    disconnect,
    getHostId: () => hostId,
    getHostName: () => hostName,
    getConnectedAt: () => connectedAt,
    getSocketId: () => socket.id,
    getHostType: () => hostType,
    getClientVersion: () => clientVersion,
  };
}

export type NaisysConnection = ReturnType<typeof createNaisysConnection>;

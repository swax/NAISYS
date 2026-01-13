import { Socket } from "socket.io";

export interface NaisysClientInfo {
  hostId: string;
  hostname: string;
  connectedAt: Date;
}

/** Generic raise event function type - all events have hostId as first arg */
export type RaiseEventFn = (
  event: string,
  hostId: string,
  ...args: unknown[]
) => void;

/**
 * Handles the lifecycle of a single NAISYS runner connection to the hub.
 * Each connected runner gets its own naisysClientService instance.
 */
export function createNaisysClientService(
  socket: Socket,
  clientInfo: NaisysClientInfo,
  raiseEvent: RaiseEventFn
) {
  const { hostId, hostname, connectedAt } = clientInfo;

  console.log(`[NaisysClient] Runner connected: ${hostname} (${hostId})`);

  // Forward all socket events to hub's emit function
  socket.onAny((eventName: string, data: unknown) => {
    console.log(`[NaisysClient] Received ${eventName} from ${hostname}`);
    raiseEvent(eventName, hostId, data);
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    console.log(
      `[NaisysClient] Runner disconnected: ${hostname} (${hostId}) - ${reason}`
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
    ack?: AckCallback<T>
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
    getHostname: () => hostname,
    getConnectedAt: () => connectedAt,
    getSocketId: () => socket.id,
  };
}

export type NaisysClientService = ReturnType<typeof createNaisysClientService>;

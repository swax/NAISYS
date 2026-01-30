import { Socket } from "socket.io";
import { HubServerLog } from "./hubServerLog.js";

export interface RunnerConnectionInfo {
  runnerId: string;
  runnerName: string;
  connectedAt: Date;
}

/** Generic raise event function type - all events have runnerId as first arg */
export type RaiseEventFn = (
  event: string,
  runnerId: string,
  ...args: unknown[]
) => void;

/**
 * Handles the lifecycle of a single NAISYS runner connection to the hub.
 * Each connected runner gets its own RunnerConnection instance.
 */
export function createRunnerConnection(
  socket: Socket,
  connectionInfo: RunnerConnectionInfo,
  raiseEvent: RaiseEventFn,
  logService: HubServerLog,
) {
  const { runnerId, runnerName, connectedAt } = connectionInfo;

  logService.log(
    `[RunnerConnection] Runner connected: ${runnerName} (${runnerId})`,
  );

  // Forward all socket events to hub's emit function
  // Note: Socket.IO passes (eventName, ...args) where last arg may be an ack callback
  socket.onAny((eventName: string, ...args: unknown[]) => {
    logService.log(
      `[RunnerConnection] Received ${eventName} from ${runnerName}`,
    );
    // Pass all args including any ack callback (usually data and optional ack)
    raiseEvent(eventName, runnerId, ...args);
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    logService.log(
      `[RunnerConnection] Runner disconnected: ${runnerName} (${runnerId}) - ${reason}`,
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
    getRunnerId: () => runnerId,
    getRunnerName: () => runnerName,
    getConnectedAt: () => connectedAt,
    getSocketId: () => socket.id,
  };
}

export type RunnerConnection = ReturnType<typeof createRunnerConnection>;

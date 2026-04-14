import type { HubStatusEvent } from "@naisys/supervisor-shared";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "../contexts/SessionContext";
import { getSocket } from "./useSocket";
import { useSubscription } from "./useSubscription";

export type ConnectionState = "connected" | "degraded" | "disconnected";

// Module-level cache (persists across remounts)
let hubConnectedCache: boolean | null = null;

export function useConnectionStatus() {
  const { isAuthenticated } = useSession();
  const [serverReachable, setServerReachable] = useState(false);
  const [, setCacheVersion] = useState(0);

  // Track socket.io connection state for server reachability (only when authenticated)
  useEffect(() => {
    if (!isAuthenticated) {
      setServerReachable(false);
      return;
    }

    const socket = getSocket();
    setServerReachable(socket.connected);

    const onConnect = () => setServerReachable(true);
    const onDisconnect = () => setServerReachable(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [isAuthenticated]);

  // Track hub connection status from WebSocket events
  const handleStatusUpdate = useCallback((event: HubStatusEvent) => {
    hubConnectedCache = event.hubConnected;
    setCacheVersion((v) => v + 1);
  }, []);

  useSubscription<HubStatusEvent>(
    isAuthenticated ? "hub-status" : null,
    handleStatusUpdate,
  );

  let status: ConnectionState;
  let label: string;

  if (!serverReachable && !isAuthenticated) {
    status = "disconnected";
    label = "Sign in for live updates";
  } else if (!serverReachable) {
    status = "disconnected";
    label = "Server unreachable";
  } else if (hubConnectedCache === false) {
    status = "degraded";
    label = "Hub disconnected";
  } else if (hubConnectedCache === true) {
    status = "connected";
    label = "Connected";
  } else {
    // Waiting for initial hub status
    status = "degraded";
    label = "Connecting...";
  }

  return { status, label };
}

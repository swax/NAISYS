import type { HubStatusEvent } from "@naisys/supervisor-shared";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "../contexts/SessionContext";
import { getSocket } from "./socket/useSocket";
import { useSubscription } from "./socket/useSubscription";

export type ConnectionState =
  | "connected"
  | "polling"
  | "hub-disconnected"
  | "disconnected";

export interface ConnectionStatus {
  status: ConnectionState;
  label: string;
  serverReachable: boolean;
}

interface ResolveConnectionStatusInput {
  isAuthenticated: boolean;
  serverReachable: boolean;
  hubConnected: boolean | null;
  transport: string | null;
}

export function resolveConnectionStatus({
  isAuthenticated,
  serverReachable,
  hubConnected,
  transport,
}: ResolveConnectionStatusInput): Pick<ConnectionStatus, "label" | "status"> {
  if (!serverReachable && !isAuthenticated) {
    return {
      status: "disconnected",
      label: "Sign in for live updates",
    };
  }

  if (!serverReachable) {
    return {
      status: "disconnected",
      label: "Server unreachable",
    };
  }

  if (hubConnected === false) {
    return {
      status: "hub-disconnected",
      label: "Hub disconnected - agent commands unavailable",
    };
  }

  if (transport === "polling") {
    return {
      status: "polling",
      label: "Using polling fallback - updates may lag",
    };
  }

  return {
    status: "connected",
    label: hubConnected === null ? "Connecting..." : "Connected",
  };
}

// Module-level cache (persists across remounts)
let hubConnectedCache: boolean | null = null;

export function useConnectionStatus(): ConnectionStatus {
  const { isAuthenticated } = useSession();
  const [serverReachable, setServerReachable] = useState(false);
  const [transport, setTransport] = useState<string | null>(null);
  const [, setCacheVersion] = useState(0);

  // Track socket.io connection state + active transport (only when authenticated)
  useEffect(() => {
    if (!isAuthenticated) {
      setServerReachable(false);
      setTransport(null);
      return;
    }

    const socket = getSocket();
    let trackedEngine: typeof socket.io.engine | null = null;
    const onUpgrade = (t: { name: string }) => setTransport(t.name);

    const trackEngine = () => {
      const engine = socket.io.engine;
      if (!engine || engine === trackedEngine) return;
      if (trackedEngine) trackedEngine.off("upgrade", onUpgrade);
      trackedEngine = engine;
      setTransport(engine.transport.name);
      engine.on("upgrade", onUpgrade);
    };

    setServerReachable(socket.connected);
    if (socket.connected) trackEngine();

    const onConnect = () => {
      setServerReachable(true);
      trackEngine();
    };
    const onDisconnect = () => {
      setServerReachable(false);
      setTransport(null);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      if (trackedEngine) trackedEngine.off("upgrade", onUpgrade);
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

  const { status, label } = resolveConnectionStatus({
    isAuthenticated,
    serverReachable,
    hubConnected: hubConnectedCache,
    transport,
  });

  return {
    status,
    label,
    serverReachable,
  };
}

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useSession } from "../contexts/SessionContext";
import { getSocket } from "./useSocket";

/**
 * Invalidate all active react-query caches whenever the socket reconnects
 * after an outage. Each hook's incremental fetch (updatedSince/logsAfter)
 * then backfills whatever pushes were missed while disconnected.
 *
 * Gated on auth so we don't open the socket before a session cookie exists
 * — the server's auth middleware would reject it and Socket.IO won't
 * automatically retry with the post-login cookie.
 */
export function useSocketReconnect() {
  const { isAuthenticated } = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();
    let hasConnected = socket.connected;

    const onConnect = () => {
      if (hasConnected) {
        void queryClient.invalidateQueries();
      }
      hasConnected = true;
    };

    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [isAuthenticated, queryClient]);
}

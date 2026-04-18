import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getSocket } from "./useSocket";

/**
 * Invalidate all active react-query caches whenever the socket reconnects
 * after an outage. Each hook's incremental fetch (updatedSince/logsAfter)
 * then backfills whatever pushes were missed while disconnected.
 */
export function useSocketReconnect() {
  const queryClient = useQueryClient();

  useEffect(() => {
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
  }, [queryClient]);
}

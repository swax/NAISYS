import { useEffect, useRef } from "react";

import { getSocket, socketHasDisconnected } from "./useSocket";

/**
 * Run `onReconnect` when the shared socket reconnects after an outage — never
 * on the first connect. Consumers use it to reconcile state that may have
 * drifted while the socket was down (typically a refetch).
 *
 * Reconnect-vs-first-connect comes from module-level socket state, so a
 * consumer that mounts *during* an outage still treats the recovery connect
 * as a reconnect. The callback is read from a ref — a fresh closure per
 * render is fine.
 */
export function useOnSocketReconnect(
  onReconnect: () => void,
  enabled: boolean = true,
): void {
  const callbackRef = useRef(onReconnect);
  callbackRef.current = onReconnect;

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const handler = () => {
      // A connect is a reconnect once the socket has dropped at least once.
      if (socketHasDisconnected()) callbackRef.current();
    };
    socket.on("connect", handler);
    return () => {
      socket.off("connect", handler);
    };
  }, [enabled]);
}

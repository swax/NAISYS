import { useEffect, useRef } from "react";

import { getSocket, socketHasDisconnected } from "./useSocket";

/**
 * Run `onReconnect` whenever the shared socket reconnects after an outage —
 * never on the first connect. A dropped socket can miss events while it's
 * down, so consumers use this to reconcile (typically a refetch).
 *
 * Reconnect-vs-first-connect is judged from module-level socket state, not
 * this listener's own history — so a consumer that mounts *during* an outage
 * still treats the recovery connect as a reconnect.
 *
 * The callback is read from a ref, so passing a fresh closure each render is
 * fine; the listener is re-registered only when `enabled` changes.
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

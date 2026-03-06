import { useEffect, useRef } from "react";

import { getSocket } from "./useSocket";

/**
 * Subscribe to a Socket.IO room. Emits subscribe/unsubscribe on mount/unmount,
 * listens for events matching the room name.
 */
export function useSubscription<T>(
  room: string | null,
  onMessage: (data: T) => void,
) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    if (!room) return;

    const socket = getSocket();

    socket.emit("subscribe", { room });

    const handler = (data: T) => callbackRef.current(data);
    socket.on(room, handler);

    return () => {
      socket.off(room, handler);
      socket.emit("unsubscribe", { room });
    };
  }, [room]);
}

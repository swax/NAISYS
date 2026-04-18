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

    const subscribe = () => socket.emit("subscribe", { room });
    subscribe();

    const handler = (data: T) => callbackRef.current(data);
    socket.on(room, handler);
    // Socket.IO drops server-side room membership on disconnect; re-emit
    // subscribe on every reconnect so pushes keep flowing after an outage.
    socket.on("connect", subscribe);

    return () => {
      socket.off(room, handler);
      socket.off("connect", subscribe);
      socket.emit("unsubscribe", { room });
    };
  }, [room]);
}

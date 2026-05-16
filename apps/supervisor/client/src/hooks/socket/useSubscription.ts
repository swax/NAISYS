import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";

import { getSocket } from "./useSocket";

type RoomHandler = (data: unknown) => void;

interface RoomSubscription {
  socket: Socket;
  handlers: Set<RoomHandler>;
  dispatch: RoomHandler;
  subscribe: () => void;
}

const roomSubscriptions = new Map<string, RoomSubscription>();

function getRoomSubscription(room: string): RoomSubscription {
  const existing = roomSubscriptions.get(room);
  if (existing) return existing;

  const socket = getSocket();
  const handlers = new Set<RoomHandler>();
  const subscribe = () => socket.emit("subscribe", { room });
  const dispatch = (data: unknown) => {
    for (const handler of handlers) handler(data);
  };
  const subscription: RoomSubscription = {
    socket,
    handlers,
    dispatch,
    subscribe,
  };

  roomSubscriptions.set(room, subscription);
  subscribe();
  socket.on(room, dispatch);
  // Socket.IO drops server-side room membership on disconnect; re-emit
  // subscribe on every reconnect so pushes keep flowing after an outage.
  socket.on("connect", subscribe);

  return subscription;
}

/**
 * Subscribe to a Socket.IO room. Emits subscribe/unsubscribe on mount/unmount,
 * listens for events matching the room name.
 *
 * The browser uses a singleton Socket.IO client, so room membership is shared
 * by every hook instance. Keep one server room subscription per room and only
 * emit unsubscribe after the last local listener has unmounted.
 */
export function useSubscription<T>(
  room: string | null,
  onMessage: (data: T) => void,
) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    if (!room) return;

    const subscription = getRoomSubscription(room);
    const handler = (data: unknown) => callbackRef.current(data as T);
    subscription.handlers.add(handler);

    return () => {
      const current = roomSubscriptions.get(room);
      if (!current) return;

      current.handlers.delete(handler);
      if (current.handlers.size > 0) return;

      current.socket.off(room, current.dispatch);
      current.socket.off("connect", current.subscribe);
      current.socket.emit("unsubscribe", { room });
      roomSubscriptions.delete(room);
    };
  }, [room]);
}

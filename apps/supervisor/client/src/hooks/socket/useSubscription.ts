import { unique } from "@naisys/common";
import { useEffect, useMemo, useRef } from "react";
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
 * Attach a handler to a shared room subscription; return its cleanup.
 * All consumers must funnel through here — a raw socket.emit("unsubscribe")
 * from outside would drop the room for everyone still holding handlers.
 */
function addRoomSubscription(room: string, handler: RoomHandler): () => void {
  const subscription = getRoomSubscription(room);
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
}

/**
 * Subscribe to a Socket.IO room. One server-side membership per room is
 * shared across hook instances and only dropped when the last local
 * listener unmounts.
 */
export function useSubscription<T>(
  room: string | null,
  onMessage: (data: T) => void,
) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    if (!room) return;
    return addRoomSubscription(room, (data) => callbackRef.current(data as T));
  }, [room]);
}

/**
 * Plural form of {@link useSubscription} for a dynamic room list. The effect
 * keys on the room SET, so entries can be re-created each render without
 * thrashing — handlers are read from a ref at dispatch time.
 */
export function useRoomSubscriptions<T>(
  entries: ReadonlyArray<{ room: string; onMessage: (data: T) => void }>,
) {
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Set fingerprint — equal sets produce equal keys regardless of order.
  const roomsKey = useMemo(
    () =>
      unique(entries.map((e) => e.room))
        .sort()
        .join("\n"),
    [entries],
  );

  useEffect(() => {
    const rooms = unique(entriesRef.current.map((e) => e.room));
    const cleanups = rooms.map((room) =>
      addRoomSubscription(room, (data) => {
        const match = entriesRef.current.find((e) => e.room === room);
        match?.onMessage(data as T);
      }),
    );
    return () => {
      for (const c of cleanups) c();
    };
  }, [roomsKey]);
}

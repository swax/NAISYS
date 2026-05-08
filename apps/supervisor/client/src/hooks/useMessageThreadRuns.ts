import type {
  LogPushSessionUpdate,
  SessionHeartbeatUpdate,
} from "@naisys/hub-protocol";
import type { RunSession } from "@naisys/supervisor-shared";
import { useEffect, useMemo, useState } from "react";

import { getMessageThreadRuns } from "../lib/apiRuns";
import { isRunActive } from "./runStatus";
import { getSocket } from "./useSocket";
import { useTick } from "./useTick";

export type ThreadRun = RunSession & { isOnline: boolean };

type RunsEvent =
  | (LogPushSessionUpdate & { type: "log-update" })
  | (SessionHeartbeatUpdate & { type: "heartbeat-update" });

const runKey = (run: {
  userId: number;
  runId: number;
  subagentId?: number | null;
  sessionId: number;
}) => `${run.userId}-${run.runId}-${run.subagentId ?? 0}-${run.sessionId}`;

/**
 * Runs that have actually participated in this chat or mail thread, derived
 * from `mail_recipients.read_run_id`. Filters out runs the agent ran outside
 * the thread (admin, other-kind messages, fire-and-forget tasks).
 */
export const useMessageThreadRuns = (
  kind: "chat" | "mail",
  currentAgentUsername: string,
  participants: string[],
) => {
  const [runMap, setRunMap] = useState<Map<string, RunSession>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [refetchTick, setRefetchTick] = useState(0);

  // Drives the 1s isOnline transition without waiting on a refetch.
  const tick = useTick(1000);

  // Matches mail_messages.participants and the relevant socket room key.
  const participantsKey = useMemo(
    () => participants.slice().sort().join(","),
    [participants],
  );

  useEffect(() => {
    if (!participantsKey || !currentAgentUsername) {
      setRunMap(new Map());
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void getMessageThreadRuns({
      kind,
      agentUsername: currentAgentUsername,
      participants: participantsKey,
    })
      .then((result) => {
        if (cancelled) return;
        const next = new Map<string, RunSession>();
        if (result.success && result.data) {
          for (const run of result.data.runs) {
            next.set(runKey(run), run);
          }
        }
        setRunMap(next);
      })
      .catch(() => {
        if (!cancelled) setRunMap(new Map());
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, participantsKey, currentAgentUsername, refetchTick]);

  // Live heartbeat/log-update for runs already in the map. New-session is
  // ignored — a fresh run isn't thread-relevant until it reads or sends a
  // message, which the message-room refetch below catches.
  useEffect(() => {
    const usernames = participantsKey
      ? participantsKey.split(",").filter(Boolean)
      : [];
    if (usernames.length === 0) return;

    const socket = getSocket();
    const cleanups: Array<() => void> = [];

    for (const username of usernames) {
      const room = `runs:${username}`;
      const subscribe = () => socket.emit("subscribe", { room });
      subscribe();

      const handler = (event: RunsEvent) => {
        if (
          event.type !== "log-update" &&
          event.type !== "heartbeat-update"
        ) {
          return;
        }
        const key = runKey(event);
        setRunMap((prev) => {
          const existing = prev.get(key);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(key, { ...existing, lastActive: event.lastActive });
          return next;
        });
      };

      socket.on(room, handler);
      socket.on("connect", subscribe);
      cleanups.push(() => {
        socket.off(room, handler);
        socket.off("connect", subscribe);
        socket.emit("unsubscribe", { room });
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [participantsKey]);

  // new-message and read-receipt both can extend the participating-run set
  // (a fresh sender or reader's run_id), so refetch on any message event.
  // Chat broadcasts per-thread (`chat-messages:{participants}`); mail
  // broadcasts per-user inbox (`mail:{username}`) — same trigger semantics.
  useEffect(() => {
    if (!participantsKey || !currentAgentUsername) return;
    const room =
      kind === "chat"
        ? `chat-messages:${participantsKey}`
        : `mail:${currentAgentUsername}`;
    const socket = getSocket();

    const subscribe = () => socket.emit("subscribe", { room });
    subscribe();

    const handler = () => setRefetchTick((t) => t + 1);
    socket.on(room, handler);
    socket.on("connect", subscribe);

    return () => {
      socket.off(room, handler);
      socket.off("connect", subscribe);
      socket.emit("unsubscribe", { room });
    };
  }, [kind, participantsKey, currentAgentUsername]);

  // Recomputes each tick. Returning a string makes the dep value-stable, so
  // the runs memo (and downstream consumers) only invalidate when an actual
  // online/offline transition happens — not every second.
  const onlineFingerprint = useMemo(() => {
    void tick;
    const keys: string[] = [];
    for (const [key, run] of runMap) {
      if (isRunActive(run.lastActive)) keys.push(key);
    }
    return keys.sort().join("|");
  }, [runMap, tick]);

  const runs: ThreadRun[] = useMemo(
    () =>
      Array.from(runMap.values()).map((run) => ({
        ...run,
        isOnline: isRunActive(run.lastActive),
      })),
    [runMap, onlineFingerprint],
  );

  return { runs, isLoading };
};

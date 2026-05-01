import type {
  CostPushEntry,
  LogPushSessionUpdate,
  SessionHeartbeatUpdate,
  SessionPush,
} from "@naisys/hub-protocol";
import type { RunSession } from "@naisys/supervisor-shared";
import { useEffect, useMemo, useState } from "react";

import { getRunsData } from "../lib/apiRuns";
import { isRunActive } from "./runStatus";
import { getSocket } from "./useSocket";
import { useTick } from "./useTick";

export type ThreadRun = RunSession & { isOnline: boolean };

type RunsLogUpdate = LogPushSessionUpdate & { type: "log-update" };
type RunsCostUpdate = CostPushEntry & { type: "cost-update" };
type RunsNewSession = SessionPush["session"] & { type: "new-session" };
type RunsHeartbeatUpdate = SessionHeartbeatUpdate & {
  type: "heartbeat-update";
};
type RunsEvent =
  | RunsLogUpdate
  | RunsCostUpdate
  | RunsNewSession
  | RunsHeartbeatUpdate;

const runKey = (run: {
  userId: number;
  runId: number;
  subagentId?: number | null;
  sessionId: number;
}) => `${run.userId}-${run.runId}-${run.subagentId ?? 0}-${run.sessionId}`;

/**
 * Fetches runs for a list of participants since `fromTime` so the thread can
 * interleave start/stop dividers. Subscribes to each participant's `runs:`
 * room so live new-session and heartbeat-update events keep the divider state
 * fresh — without subscriptions, online runs would falsely flip "stopped" 8s
 * after mount once their cached `lastActive` got stale.
 */
export const useThreadRuns = (
  participants: string[],
  fromTime: string | null,
) => {
  const [runMap, setRunMap] = useState<Map<string, RunSession>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Re-tick once per second so freshly stopped runs flip isOnline → false and
  // a stop divider can appear without waiting for a refetch.
  useTick(1000);

  const participantsKey = useMemo(
    () => participants.slice().sort().join(","),
    [participants],
  );

  // Initial REST fetch. Reruns when participants or fromTime change.
  useEffect(() => {
    if (!fromTime || participants.length === 0) {
      setRunMap(new Map());
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    Promise.all(
      participants.map((username) =>
        getRunsData({
          agentUsername: username,
          updatedSince: fromTime,
          count: 100,
        }).catch(() => null),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const next = new Map<string, RunSession>();
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result?.success && result.data) {
            const username = participants[i];
            for (const run of result.data.runs) {
              const fullRun = { ...run, username: run.username ?? username };
              next.set(runKey(fullRun), fullRun);
            }
          }
        }
        setRunMap(next);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [participantsKey, fromTime]);

  // Live subscription per participant. Merges new sessions and lastActive
  // updates from log/heartbeat events into the map.
  useEffect(() => {
    if (participants.length === 0) return;

    const socket = getSocket();
    const cleanups: Array<() => void> = [];

    for (const username of participants) {
      const room = `runs:${username}`;

      const subscribe = () => socket.emit("subscribe", { room });
      subscribe();

      const handler = (event: RunsEvent) => {
        if (event.type === "new-session") {
          const newRun: RunSession = {
            userId: event.userId,
            runId: event.runId,
            subagentId: event.subagentId,
            sessionId: event.sessionId,
            modelName: event.modelName,
            createdAt: event.createdAt,
            lastActive: event.lastActive,
            latestLogId: event.latestLogId,
            totalLines: event.totalLines,
            totalCost: event.totalCost,
            username,
          };
          setRunMap((prev) => {
            const next = new Map(prev);
            next.set(runKey(newRun), newRun);
            return next;
          });
        } else if (
          event.type === "log-update" ||
          event.type === "heartbeat-update"
        ) {
          const key = runKey(event);
          setRunMap((prev) => {
            const existing = prev.get(key);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(key, { ...existing, lastActive: event.lastActive });
            return next;
          });
        }
        // cost-update: ignored — doesn't affect start/stop dividers.
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

  const runs: ThreadRun[] = useMemo(
    () =>
      Array.from(runMap.values()).map((run) => ({
        ...run,
        isOnline: isRunActive(run.lastActive),
      })),
    [runMap],
  );

  return { runs, isLoading };
};

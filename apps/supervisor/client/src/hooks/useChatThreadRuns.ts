import type {
  CostPushEntry,
  LogPushSessionUpdate,
  SessionHeartbeatUpdate,
} from "@naisys/hub-protocol";
import type { RunSession } from "@naisys/supervisor-shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getChatThreadRuns } from "../lib/apiRuns";
import { isRunActive } from "./runStatus";
import { getSocket } from "./useSocket";
import type { ThreadRun } from "./useThreadRuns";
import { useTick } from "./useTick";

type RunsLogUpdate = LogPushSessionUpdate & { type: "log-update" };
type RunsCostUpdate = CostPushEntry & { type: "cost-update" };
type RunsHeartbeatUpdate = SessionHeartbeatUpdate & {
  type: "heartbeat-update";
};
type RunsEvent = RunsLogUpdate | RunsCostUpdate | RunsHeartbeatUpdate;

const runKey = (run: {
  userId: number;
  runId: number;
  subagentId?: number | null;
  sessionId: number;
}) => `${run.userId}-${run.runId}-${run.subagentId ?? 0}-${run.sessionId}`;

/**
 * Fetch the runs that have actually participated in a chat thread, derived
 * server-side from `mail_recipients.read_run_id`. This filters out admin /
 * config / mail / fire-and-forget runs that the agent ran outside the chat,
 * so dividers and auto-load only see chat-relevant runs.
 *
 * Refetches whenever a chat-messages socket event fires (new message or read
 * receipt) — both can extend the participating-run set. Live heartbeat and
 * log-update events still flow per `runs:{username}` room, but only update
 * runs we already have in the chat-scoped map.
 */
export const useChatThreadRuns = (
  currentAgentUsername: string,
  participants: string[],
) => {
  const [runMap, setRunMap] = useState<Map<string, RunSession>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Bumped whenever a chat-messages socket event arrives, to trigger a
  // refetch and pick up newly-participating runs.
  const [refetchTick, setRefetchTick] = useState(0);

  // Tick once a second so freshly-stopped runs flip isOnline → false without
  // waiting for an explicit refetch.
  useTick(1000);

  // Sorted CSV — matches mail_messages.participants and the chat-messages
  // socket room key. Empty string when there's no thread to fetch.
  const participantsKey = useMemo(
    () => participants.slice().sort().join(","),
    [participants],
  );

  // REST fetch. Reruns when participants change or when a chat-messages event
  // hints that the participating set may have grown.
  useEffect(() => {
    if (!participantsKey || !currentAgentUsername) {
      setRunMap(new Map());
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void getChatThreadRuns({
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
        if (cancelled) return;
        setRunMap(new Map());
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [participantsKey, currentAgentUsername, refetchTick]);

  // Live heartbeat / log-update updates for runs we already have. We
  // intentionally skip new-session here — a fresh run isn't necessarily
  // chat-relevant. The chat-messages room handler below picks up new
  // chat-relevant runs via refetch.
  useEffect(() => {
    if (participants.length === 0) return;

    const socket = getSocket();
    const cleanups: Array<() => void> = [];

    for (const username of participants) {
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

  // Subscribe to the chat-messages room — any event there (new-message or
  // read-receipt) is a hint that read_run_id may have changed for some user,
  // which in turn may change the participating run set. Refetch on signal.
  const bumpRefetch = useCallback(() => {
    setRefetchTick((t) => t + 1);
  }, []);

  const bumpRefetchRef = useRef(bumpRefetch);
  bumpRefetchRef.current = bumpRefetch;

  useEffect(() => {
    if (!participantsKey) return;
    const room = `chat-messages:${participantsKey}`;

    const socket = getSocket();
    const subscribe = () => socket.emit("subscribe", { room });
    subscribe();

    const handler = () => bumpRefetchRef.current();
    socket.on(room, handler);
    socket.on("connect", subscribe);

    return () => {
      socket.off(room, handler);
      socket.off("connect", subscribe);
      socket.emit("unsubscribe", { room });
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

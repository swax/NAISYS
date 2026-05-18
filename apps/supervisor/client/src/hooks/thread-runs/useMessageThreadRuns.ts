import type {
  CommandLoopState,
  LogPushSessionUpdate,
  SessionHeartbeatUpdate,
  SessionPush,
} from "@naisys/hub-protocol";
import type { RunSession } from "@naisys/supervisor-shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getMessageThreadRuns } from "../../lib/api/apiRuns";
import {
  useRoomSubscriptions,
  useSubscription,
} from "../socket/useSubscription";
import { useTick } from "../useTick";
import { isRunActive } from "./runStatus";

type StoredRun = RunSession & {
  paused?: boolean;
  state?: CommandLoopState;
};

export type ThreadRun = StoredRun & { isOnline: boolean };

type RunsHeartbeatUpdate = SessionHeartbeatUpdate & {
  type: "heartbeat-update";
  activeSubagentCount: number;
};

type RunsEvent =
  | (LogPushSessionUpdate & { type: "log-update" })
  | RunsHeartbeatUpdate
  | (SessionPush["session"] & { type: "new-session" });

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
  const [runMap, setRunMap] = useState<Map<string, StoredRun>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [refetchTick, setRefetchTick] = useState(0);

  // Socket handler needs a synchronous read of the current map to decide
  // refetch vs patch — setRunMap's updater runs during commit, too late.
  const runMapRef = useRef(runMap);
  useEffect(() => {
    runMapRef.current = runMap;
  }, [runMap]);

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
        const next = new Map<string, StoredRun>();
        if (result.success && result.data) {
          // Preserve heartbeat-derived paused/state across refetches — the
          // REST payload doesn't carry them and we don't want a refetch to
          // appear to "unpause" an agent.
          const prev = runMapRef.current;
          for (const run of result.data.runs) {
            const key = runKey(run);
            const existing = prev.get(key);
            next.set(key, {
              ...run,
              paused: existing?.paused,
              state: existing?.state,
            });
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

  // Subagent rows still need to land in the map even though the badge reads
  // its count from the parent: useThreadRunCommands subscribes to a log room
  // per (runId, subagentId, sessionId), so without them the subagent's
  // command stream stays dark.
  const handleRunsEvent = useCallback((event: RunsEvent) => {
    if (
      event.type !== "log-update" &&
      event.type !== "heartbeat-update" &&
      event.type !== "new-session"
    ) {
      return;
    }
    const key = runKey(event);
    const map = runMapRef.current;
    if (map.has(key)) {
      setRunMap((prev) => {
        const existing = prev.get(key);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(key, {
          ...existing,
          lastActive: event.lastActive,
          ...(event.type === "heartbeat-update"
            ? {
                activeSubagentCount: event.activeSubagentCount,
                paused: event.paused,
                state: event.state,
              }
            : {}),
        });
        return next;
      });
      return;
    }
    for (const run of map.values()) {
      if (run.userId === event.userId && run.runId === event.runId) {
        setRefetchTick((t) => t + 1);
        return;
      }
    }
  }, []);

  const runsSubscriptionEntries = useMemo(() => {
    const usernames = participantsKey
      ? participantsKey.split(",").filter(Boolean)
      : [];
    return usernames.map((username) => ({
      room: `runs:${username}`,
      onMessage: handleRunsEvent,
    }));
  }, [participantsKey, handleRunsEvent]);

  useRoomSubscriptions<RunsEvent>(runsSubscriptionEntries);

  // new-message and read-receipt both can extend the participating-run set
  // (a fresh sender or reader's run_id), so refetch on any message event.
  // Chat broadcasts per-thread (`chat-messages:{participants}`); mail
  // broadcasts per-user inbox (`mail:{username}`) — same trigger semantics.
  const messageRoom = useMemo(() => {
    if (!participantsKey || !currentAgentUsername) return null;
    return kind === "chat"
      ? `chat-messages:${participantsKey}`
      : `mail:${currentAgentUsername}`;
  }, [kind, participantsKey, currentAgentUsername]);

  const handleMessageEvent = useCallback(() => {
    setRefetchTick((t) => t + 1);
  }, []);

  useSubscription<unknown>(messageRoom, handleMessageEvent);

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

  const patchRun = useCallback(
    (
      userId: number,
      runId: number,
      sessionId: number,
      subagentId: number | null | undefined,
      patch: Partial<StoredRun>,
    ) => {
      setRunMap((prev) => {
        const key = runKey({ userId, runId, subagentId, sessionId });
        const existing = prev.get(key);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(key, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  return { runs, isLoading, patchRun };
};

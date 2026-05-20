import { mergeByKey } from "@naisys/common";
import type {
  CommandLoopState,
  CostPushEntry,
  LogPushSessionUpdate,
  SessionHeartbeatUpdate,
} from "@naisys/hub-protocol";
import type { RunSession as BaseRunSession } from "@naisys/supervisor-shared";

type CachedRunSession = BaseRunSession & {
  activeSubagentCount?: number;
  paused?: boolean;
  state?: CommandLoopState;
};
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { getRunsData } from "../../lib/api/apiRuns";
import type { RunSession } from "../../types/runSession";
import { useSubscription } from "../socket/useSubscription";

type RunSessionWithFlag = RunSession & { isFirst?: boolean };

const runKey = (run: {
  userId: number;
  runId: number;
  subagentId?: number | null;
  sessionId: number;
}) => `${run.userId}-${run.runId}-${run.subagentId ?? 0}-${run.sessionId}`;

// Module-level caches (shared across all hook instances and persist across remounts)
const runsCache = new Map<string, CachedRunSession[]>();
const totalCache = new Map<string, number>();
const pagesLoadedCache = new Map<string, number>();

type RunsLogUpdate = LogPushSessionUpdate & { type: "log-update" };
type RunsCostUpdate = CostPushEntry & { type: "cost-update" };
type RunsHeartbeatUpdate = SessionHeartbeatUpdate & {
  type: "heartbeat-update";
  activeSubagentCount: number;
  online: boolean;
};
type RunsEvent = RunsLogUpdate | RunsCostUpdate | RunsHeartbeatUpdate;

export const useRunsData = (agentUsername: string, enabled: boolean = true) => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);
  const queryClient = useQueryClient();

  const mergeRuns = useCallback(
    (updatedRuns: CachedRunSession[], total?: number) => {
      if (updatedRuns.length === 0 && total === undefined) return;

      const existingRuns = runsCache.get(agentUsername) || [];

      const mergedRuns = mergeByKey(existingRuns, updatedRuns, runKey);
      const newCount = mergedRuns.length - existingRuns.length;

      // Mirror the server's run_id desc → subagent_id desc → created_at desc
      // ordering so parent rows stay grouped with their subagents and rows
      // don't shift as lastActive updates stream in.
      mergedRuns.sort((a, b) => {
        if (a.runId !== b.runId) return b.runId - a.runId;
        const aSub = a.subagentId ?? 0;
        const bSub = b.subagentId ?? 0;
        if (aSub !== bSub) return bSub - aSub;
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });

      runsCache.set(agentUsername, mergedRuns);

      if (total !== undefined) {
        totalCache.set(agentUsername, total);
      } else if (newCount > 0) {
        const currentTotal = totalCache.get(agentUsername) || 0;
        totalCache.set(agentUsername, currentTotal + newCount);
      }

      setCacheVersion((v) => v + 1);
    },
    [agentUsername],
  );

  const patchRun = useCallback(
    (
      userId: number,
      runId: number,
      sessionId: number,
      subagentId: number | null | undefined,
      patch: Partial<CachedRunSession>,
    ) => {
      const existing = (runsCache.get(agentUsername) || []).find(
        (r) =>
          r.userId === userId &&
          r.runId === runId &&
          r.sessionId === sessionId &&
          (r.subagentId ?? 0) === (subagentId ?? 0),
      );
      if (!existing) return;
      mergeRuns([{ ...existing, ...patch }]);
    },
    [agentUsername, mergeRuns],
  );

  const handleRunsEvent = useCallback(
    (event: RunsEvent) => {
      const existingRuns = runsCache.get(agentUsername) || [];
      const key = runKey(event);
      const existing = existingRuns.find((r) => runKey(r) === key);

      if (event.type === "heartbeat-update") {
        if (existing) {
          const updated: CachedRunSession = {
            ...existing,
            lastActive: event.lastActive,
            isOnline: event.online,
            activeSubagentCount: event.activeSubagentCount,
            paused: event.paused,
            state: event.state,
            totalTokens: event.totalTokens ?? existing.totalTokens,
          };
          mergeRuns([updated]);
        } else if (event.online) {
          // A run we don't have yet (created after page load) — pull the full
          // row via REST.
          void queryClient.invalidateQueries({
            queryKey: ["runs-data", agentUsername],
          });
        }
        return;
      }

      // log-update / cost-update only refine a run we already know about.
      if (!existing) return;

      if (event.type === "log-update") {
        const updated: CachedRunSession = {
          ...existing,
          lastActive: event.lastActive,
          latestLogId: event.latestLogId,
          totalLines: existing.totalLines + event.totalLinesDelta,
        };
        mergeRuns([updated]);
      } else if (event.type === "cost-update") {
        const updated: CachedRunSession = {
          ...existing,
          totalCost: existing.totalCost + event.costDelta,
        };
        mergeRuns([updated]);
      }
    },
    [agentUsername, mergeRuns, queryClient],
  );

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentUsername] = queryKey;

    // Always a full page-1 fetch — no updatedSince cursor. The socket carries
    // live updates; this query only reconciles (mount, focus, reconnect). An
    // incremental cursor can't see a run that went offline — its last_active
    // froze — so a missed online:false event would strand the row online
    // forever. Page 1 covers every online run (rows are ordered run_id desc).
    return await getRunsData({ agentUsername, page: 1, count: 50 });
  }, []);

  const query = useQuery({
    queryKey: ["runs-data", agentUsername],
    queryFn,
    enabled: enabled && !!agentUsername,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: 1000,
  });

  // Merge REST data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      mergeRuns(query.data.data.runs, query.data.data.total);
    }
  }, [query.data, mergeRuns]);

  // WebSocket subscription for real-time run updates
  useSubscription<RunsEvent>(
    enabled && agentUsername ? `runs:${agentUsername}` : null,
    handleRunsEvent,
  );

  // Reconnect recovery is app-wide: useSocketReconnect (App.tsx) invalidates
  // every query on reconnect, and this query's fetch is full — so a missed
  // online:false is reconciled without a per-hook listener here.

  // Load more (next page of historical data)
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = (pagesLoadedCache.get(agentUsername) || 1) + 1;
      const result = await getRunsData({
        agentUsername,
        page: nextPage,
        count: 50,
      });
      if (result.success && result.data) {
        mergeRuns(result.data.runs, result.data.total);
        pagesLoadedCache.set(agentUsername, nextPage);
      }
    } catch (err) {
      console.error("Error loading more runs:", err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [agentUsername, mergeRuns]);

  // Get current runs from cache, compute isOnline at read time
  const baseRuns = runsCache.get(agentUsername) || [];
  const runs: RunSessionWithFlag[] = baseRuns.map((run, index) => ({
    ...run,
    isFirst: index === 0,
  }));
  const total = totalCache.get(agentUsername) || 0;
  const hasMore = runs.length < total;

  return {
    runs,
    total,
    isLoading: query.isLoading,
    error: query.error,
    isFetchedAfterMount: query.isFetchedAfterMount,
    loadMore,
    loadingMore,
    hasMore,
    patchRun,
  };
};

import type {
  CostPushEntry,
  LogPushSessionUpdate,
  SessionHeartbeatUpdate,
  SessionPush,
} from "@naisys/hub-protocol";
import type { RunSession as BaseRunSession } from "@naisys/supervisor-shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { RunsDataParams } from "../lib/apiRuns";
import { getRunsData } from "../lib/apiRuns";
import type { RunSession } from "../types/runSession";
import { isRunActive } from "./runStatus";
import { useSubscription } from "./useSubscription";
import { useTick } from "./useTick";

type RunSessionWithFlag = RunSession & { isFirst?: boolean };

// Module-level caches (shared across all hook instances and persist across remounts)
const runsCache = new Map<string, BaseRunSession[]>();
const updatedSinceCache = new Map<string, string | undefined>();
const totalCache = new Map<string, number>();
const pagesLoadedCache = new Map<string, number>();

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

export const useRunsData = (agentUsername: string, enabled: boolean = true) => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  // Force a re-render every second so isOnline recomputes off the threshold
  // even when no socket events are arriving (e.g. dead host, dropped socket).
  useTick(1000);

  const mergeRuns = useCallback(
    (updatedRuns: BaseRunSession[], total?: number) => {
      if (updatedRuns.length === 0 && total === undefined) return;

      const existingRuns = runsCache.get(agentUsername) || [];

      const mergeMap = new Map<string, BaseRunSession>(
        existingRuns.map((run) => [
          `${run.userId}-${run.runId}-${run.sessionId}`,
          run,
        ]),
      );

      const existingCount = mergeMap.size;

      updatedRuns.forEach((run: BaseRunSession) => {
        mergeMap.set(`${run.userId}-${run.runId}-${run.sessionId}`, run);
      });

      const mergedRuns = Array.from(mergeMap.values());
      const newCount = mergedRuns.length - existingCount;

      // Sort by created date (most recent first) so rows don't shift as
      // lastActive updates stream in.
      mergedRuns.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      runsCache.set(agentUsername, mergedRuns);

      if (total !== undefined) {
        totalCache.set(agentUsername, total);
      } else if (newCount > 0) {
        const currentTotal = totalCache.get(agentUsername) || 0;
        totalCache.set(agentUsername, currentTotal + newCount);
      }

      updatedSinceCache.set(agentUsername, new Date().toISOString());

      setCacheVersion((v) => v + 1);
    },
    [agentUsername],
  );

  const handleRunsEvent = useCallback(
    (event: RunsEvent) => {
      const existingRuns = runsCache.get(agentUsername) || [];
      const key = `${event.userId}-${event.runId}-${event.sessionId}`;

      if (event.type === "new-session") {
        // Add new session as a full RunSession
        const newRun: BaseRunSession = {
          userId: event.userId,
          runId: event.runId,
          sessionId: event.sessionId,
          modelName: event.modelName,
          createdAt: event.createdAt,
          lastActive: event.lastActive,
          latestLogId: event.latestLogId,
          totalLines: event.totalLines,
          totalCost: event.totalCost,
        };
        mergeRuns([newRun]);
        return;
      }

      // Find existing run to update
      const existing = existingRuns.find(
        (r) => `${r.userId}-${r.runId}-${r.sessionId}` === key,
      );
      if (!existing) return;

      if (event.type === "log-update") {
        const updated: BaseRunSession = {
          ...existing,
          lastActive: event.lastActive,
          latestLogId: event.latestLogId,
          totalLines: existing.totalLines + event.totalLinesDelta,
        };
        mergeRuns([updated]);
      } else if (event.type === "cost-update") {
        const updated: BaseRunSession = {
          ...existing,
          totalCost: existing.totalCost + event.costDelta,
        };
        mergeRuns([updated]);
      } else if (event.type === "heartbeat-update") {
        const updated: BaseRunSession = {
          ...existing,
          lastActive: event.lastActive,
        };
        mergeRuns([updated]);
      }
    },
    [agentUsername, mergeRuns],
  );

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentUsername] = queryKey;

    const params: RunsDataParams = {
      agentUsername,
      updatedSince: updatedSinceCache.get(agentUsername),
      page: 1,
      count: 50,
    };

    return await getRunsData(params);
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
    isOnline: isRunActive(run.lastActive),
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
  };
};


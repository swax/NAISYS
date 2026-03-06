import { RunSession as BaseRunSession } from "@naisys-supervisor/shared";
import type {
  CostPushEntry,
  LogPushSessionUpdate,
  SessionPush,
} from "@naisys/hub-protocol";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { getRunsData, RunsDataParams } from "../lib/apiRuns";
import { RunSession } from "../types/runSession";
import { useSubscription } from "./useSubscription";

type RunSessionWithFlag = RunSession & { isFirst?: boolean };

// Module-level caches (shared across all hook instances and persist across remounts)
const runsCache = new Map<number, BaseRunSession[]>();
const updatedSinceCache = new Map<number, string | undefined>();
const totalCache = new Map<number, number>();

type RunsLogUpdate = LogPushSessionUpdate & { type: "log-update" };
type RunsCostUpdate = CostPushEntry & { type: "cost-update" };
type RunsNewSession = SessionPush["session"] & { type: "new-session" };
type RunsEvent = RunsLogUpdate | RunsCostUpdate | RunsNewSession;

export const useRunsData = (agentId: number, enabled: boolean = true) => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const mergeRuns = useCallback(
    (updatedRuns: BaseRunSession[], total?: number) => {
      if (updatedRuns.length === 0 && total === undefined) return;

      const existingRuns = runsCache.get(agentId) || [];

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

      // Sort by last active (most recent first)
      mergedRuns.sort(
        (a, b) =>
          new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime(),
      );

      runsCache.set(agentId, mergedRuns);

      if (total !== undefined) {
        totalCache.set(agentId, total);
      } else if (newCount > 0) {
        const currentTotal = totalCache.get(agentId) || 0;
        totalCache.set(agentId, currentTotal + newCount);
      }

      updatedSinceCache.set(agentId, new Date().toISOString());

      setCacheVersion((v) => v + 1);
    },
    [agentId],
  );

  const handleRunsEvent = useCallback(
    (event: RunsEvent) => {
      const existingRuns = runsCache.get(agentId) || [];
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
      }
    },
    [agentId, mergeRuns],
  );

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, agentId] = queryKey;

    const params: RunsDataParams = {
      agentId,
      updatedSince: updatedSinceCache.get(agentId),
      page: 1,
      count: 50,
    };

    return await getRunsData(params);
  }, []);

  const query = useQuery({
    queryKey: ["runs-data", agentId],
    queryFn,
    enabled: enabled && !!agentId,
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
    enabled && agentId ? `runs:${agentId}` : null,
    handleRunsEvent,
  );

  // Get current runs from cache, compute isOnline at read time
  const baseRuns = runsCache.get(agentId) || [];
  const runs: RunSessionWithFlag[] = baseRuns.map((run, index) => ({
    ...run,
    isOnline: isRunActive(run.lastActive),
    isFirst: index === 0,
  }));
  const total = totalCache.get(agentId) || 0;

  return {
    runs,
    total,
    isLoading: query.isLoading,
    error: query.error,
    isFetchedAfterMount: query.isFetchedAfterMount,
  };
};

/** A run session is considered active if updated within the last 16 seconds */
const RUN_ACTIVE_THRESHOLD_MS = 16_000;

function isRunActive(lastActive?: string): boolean {
  if (!lastActive) return false;
  const diffInMs = Date.now() - new Date(lastActive).getTime();
  return 0 < diffInMs && diffInMs < RUN_ACTIVE_THRESHOLD_MS;
}

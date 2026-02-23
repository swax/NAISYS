import { RunSession as BaseRunSession } from "@naisys-supervisor/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { getRunsData, RunsDataParams } from "../lib/apiRuns";
import { RunSession } from "../types/runSession";

type RunSessionWithFlag = RunSession & { isFirst?: boolean };

// Module-level caches (shared across all hook instances and persist across remounts)
const runsCache = new Map<number, RunSessionWithFlag[]>();
const updatedSinceCache = new Map<number, string | undefined>();
const totalCache = new Map<number, number>();

export const useRunsData = (agentId: number, enabled: boolean = true) => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

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
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always", // Immediate update when agentId changes
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const updatedRuns = query.data.data.runs;
      const total = query.data.data.total;

      const existingRuns = runsCache.get(agentId) || [];

      // Create a map of existing runs for quick lookup (using BaseRunSession to allow updates)
      const mergeRuns = new Map<string, BaseRunSession>(
        existingRuns.map((run) => [
          `${run.userId}-${run.runId}-${run.sessionId}`,
          run,
        ]),
      );

      // Count how many new runs we're adding
      const existingCount = mergeRuns.size;

      // Update existing runs and add new ones
      updatedRuns.forEach((run: BaseRunSession) => {
        mergeRuns.set(`${run.userId}-${run.runId}-${run.sessionId}`, run);
      });

      const mergedRuns = Array.from(mergeRuns.values());
      const newCount = mergedRuns.length - existingCount;

      // Recalculate online status for all runs after merging
      const runsWithOnline: RunSession[] = mergedRuns.map((run) => ({
        ...run,
        isOnline: isRunActive(run.lastActive, query.dataUpdatedAt),
      }));

      // Sort and mark runs once when updating cache
      const sortedRuns = sortAndMarkRuns(runsWithOnline);

      // Update cache with sorted runs
      runsCache.set(agentId, sortedRuns);

      // Update total cache
      if (total !== undefined) {
        // Initial fetch with total count
        totalCache.set(agentId, total);
      } else if (newCount > 0) {
        // Incremental fetch - add new items to existing total
        const currentTotal = totalCache.get(agentId) || 0;
        totalCache.set(agentId, currentTotal + newCount);
      }

      // Update updatedSince with the current timestamp
      updatedSinceCache.set(agentId, new Date().toISOString());

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, agentId]);

  // Get current runs from cache (already sorted and marked)
  const runs = runsCache.get(agentId) || [];
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

function isRunActive(lastActive?: string, referenceTime?: number): boolean {
  if (!lastActive) return false;
  const now = referenceTime ?? Date.now();
  const diffInMs = now - new Date(lastActive).getTime();
  return 0 < diffInMs && diffInMs < RUN_ACTIVE_THRESHOLD_MS;
}

function sortAndMarkRuns(runs: RunSession[]): RunSessionWithFlag[] {
  // Sort by last active (oldest first, latest at bottom)
  const sortedRuns: RunSessionWithFlag[] = [...runs].sort(
    (a, b) =>
      new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime(),
  );

  // Mark first run
  if (sortedRuns.length > 0) {
    sortedRuns[0].isFirst = true;
  }

  return sortedRuns;
}

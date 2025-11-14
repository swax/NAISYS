import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { RunSession as BaseRunSession } from "shared";
import { isAgentOnline } from "../lib/agentUtils";
import { getRunsData, RunsDataParams } from "../lib/apiClient";
import { RunSession } from "../types/runSession";

type RunSessionWithFlag = RunSession & { isFirst?: boolean };

// Module-level caches (shared across all hook instances and persist across remounts)
const runsCache = new Map<number, RunSessionWithFlag[]>();
const updatedSinceCache = new Map<number, string | undefined>();

export const useRunsData = (userId: number, enabled: boolean = true) => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, userId] = queryKey;

    const params: RunsDataParams = {
      userId,
      updatedSince: updatedSinceCache.get(userId),
    };

    return await getRunsData(params);
  }, []);

  const query = useQuery({
    queryKey: ["runs-data", userId],
    queryFn,
    enabled: enabled && userId > 0,
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    refetchOnMount: "always", // Always refetch when userId changes
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const updatedRuns = query.data.data.runs;

      const existingRuns = runsCache.get(userId) || [];

      // Create a map of existing runs for quick lookup (using BaseRunSession to allow updates)
      const mergeRuns = new Map<string, BaseRunSession>(
        existingRuns.map((run) => [
          `${run.userId}-${run.runId}-${run.sessionId}`,
          run,
        ]),
      );

      // Update existing runs and add new ones
      updatedRuns.forEach((run: BaseRunSession) => {
        mergeRuns.set(`${run.userId}-${run.runId}-${run.sessionId}`, run);
      });

      const mergedRuns = Array.from(mergeRuns.values());

      // Recalculate online status for all runs after merging
      const runsWithOnline: RunSession[] = mergedRuns.map((run) => ({
        ...run,
        isOnline: isAgentOnline(run.lastActive, query.dataUpdatedAt),
      }));

      // Sort and mark runs once when updating cache
      const sortedRuns = sortAndMarkRuns(runsWithOnline);

      // Update cache with sorted runs
      runsCache.set(userId, sortedRuns);

      // Update updatedSince with the current timestamp
      updatedSinceCache.set(userId, new Date().toISOString());

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, userId]);

  // Get current runs from cache (already sorted and marked)
  const runs = runsCache.get(userId) || [];

  return {
    runs,
    isLoading: query.isLoading,
    error: query.error,
    isFetchedAfterMount: query.isFetchedAfterMount,
  };
};

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

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRunsData, RunsDataParams, RunSession } from "../lib/apiClient";

type RunSessionWithFlag = RunSession & { isLast?: boolean };

export const useRunsData = (userId: number, enabled: boolean = true) => {
  // Store merged runs per userId (stored sorted with isLast flag)
  const runsCache = useRef<Map<number, RunSessionWithFlag[]>>(new Map());
  // Store updatedSince per userId
  const updatedSinceCache = useRef<Map<number, string | undefined>>(new Map());
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, userId] = queryKey;

    const params: RunsDataParams = {
      userId,
      updatedSince: updatedSinceCache.current.get(userId),
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
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const updatedRuns = query.data.data.runs;

      const existingRuns = runsCache.current.get(userId) || [];

      // Create a map of existing runs for quick lookup
      const mergeRuns = new Map(
        existingRuns.map((run) => [
          `${run.userId}-${run.runId}-${run.sessionId}`,
          run,
        ]),
      );

      // Update existing runs and add new ones
      updatedRuns.forEach((run) => {
        mergeRuns.set(`${run.userId}-${run.runId}-${run.sessionId}`, run);
      });

      const mergedRuns = Array.from(mergeRuns.values());

      // Sort and mark runs once when updating cache
      const sortedRuns = sortAndMarkRuns(mergedRuns);

      // Update cache with sorted runs
      runsCache.current.set(userId, sortedRuns);

      // Update updatedSince with the current timestamp
      updatedSinceCache.current.set(userId, new Date().toISOString());

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, userId]);

  // Get current runs from cache (already sorted and marked)
  const runs = runsCache.current.get(userId) || [];

  return {
    runs,
    isLoading: query.isLoading,
    error: query.error,
  };
};

function sortAndMarkRuns(runs: RunSession[]): RunSessionWithFlag[] {
  // Sort by last active (oldest first, latest at bottom)
  const sortedRuns: RunSessionWithFlag[] = [...runs].sort(
    (a, b) =>
      new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime(),
  );

  // Mark last run
  if (sortedRuns.length > 0) {
    sortedRuns[sortedRuns.length - 1].isLast = true;
  }

  return sortedRuns;
}

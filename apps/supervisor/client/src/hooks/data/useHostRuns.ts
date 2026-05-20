import { useCallback } from "react";

import { getHostRuns } from "../../lib/api/apiRuns";
import { useLiveRuns } from "./useLiveRuns";

const PAGE_SIZE = 15;

/**
 * Runs recorded on a host, newest first, kept live from each run's
 * `runs:${username}` room (the hub has no host-scoped room). `pullNewRuns` is
 * on, so a new run by an already-listed agent appears live; one by an agent
 * with no runs listed yet waits for the next refetch.
 */
export const useHostRuns = (hostname: string | undefined) => {
  const fetchPage = useCallback(
    async (page: number) => {
      if (!hostname) return null;
      const result = await getHostRuns({ hostname, page, count: PAGE_SIZE });
      if (result.success && result.data) {
        return {
          runs: result.data.runs,
          total: result.data.total ?? result.data.runs.length,
        };
      }
      return null;
    },
    [hostname],
  );

  const { runs, total, isLoading, loadMore, loadingMore, hasMore } =
    useLiveRuns({
      resetKey: hostname ? `host:${hostname}` : null,
      fetchPage,
      pullNewRuns: true,
    });

  return { runs, total, isLoading, loadMore, loadingMore, hasMore };
};

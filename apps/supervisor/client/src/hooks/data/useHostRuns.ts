import { useCallback } from "react";

import { getHostRuns } from "../../lib/api/apiRuns";
import { useLiveRuns } from "./useLiveRuns";

const PAGE_SIZE = 15;

/**
 * Runs recorded on a host, newest first, kept live — online/offline, cost and
 * line counts update from socket pushes. A host's runs span many agents and
 * the hub has no host-scoped room, so liveness rides each run's own
 * `runs:${username}` room (see useLiveRuns). `pullNewRuns` is on: a new run by
 * an agent already in the list is pulled in live; one by an agent with no runs
 * listed yet lands on the next refetch (reconnect or navigation).
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

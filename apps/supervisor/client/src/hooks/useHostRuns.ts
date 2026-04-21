import type { RunSession as BaseRunSession } from "@naisys/supervisor-shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { getHostRuns } from "../lib/apiRuns";
import type { RunSession } from "../types/runSession";
import { isRunActive } from "./runStatus";
import { useTick } from "./useTick";

const PAGE_SIZE = 15;

export const useHostRuns = (hostname: string | undefined) => {
  useTick(1000);

  const [baseRuns, setBaseRuns] = useState<BaseRunSession[]>([]);
  const [total, setTotal] = useState(0);
  const [pagesLoaded, setPagesLoaded] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Reset and fetch page 1 whenever hostname changes
  useEffect(() => {
    if (!hostname) {
      setBaseRuns([]);
      setTotal(0);
      setPagesLoaded(0);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setBaseRuns([]);
    setTotal(0);
    setPagesLoaded(0);

    void (async () => {
      try {
        const result = await getHostRuns({
          hostname,
          page: 1,
          count: PAGE_SIZE,
        });
        if (cancelled) return;
        if (result.success && result.data) {
          setBaseRuns(result.data.runs);
          setTotal(result.data.total ?? result.data.runs.length);
          setPagesLoaded(1);
        }
      } catch (err) {
        console.error("Error fetching host runs:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hostname]);

  const loadMore = useCallback(async () => {
    if (!hostname || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = pagesLoaded + 1;
      const result = await getHostRuns({
        hostname,
        page: nextPage,
        count: PAGE_SIZE,
      });
      if (result.success && result.data) {
        setBaseRuns((prev) => {
          const seen = new Set(
            prev.map((r) => `${r.userId}-${r.runId}-${r.sessionId}`),
          );
          const additions = result.data!.runs.filter(
            (r) => !seen.has(`${r.userId}-${r.runId}-${r.sessionId}`),
          );
          return [...prev, ...additions];
        });
        setPagesLoaded(nextPage);
        if (result.data.total !== undefined) setTotal(result.data.total);
      }
    } catch (err) {
      console.error("Error loading more host runs:", err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hostname, pagesLoaded]);

  const runs: RunSession[] = baseRuns.map((run) => ({
    ...run,
    isOnline: isRunActive(run.lastActive),
  }));

  const hasMore = runs.length < total;

  return {
    runs,
    total,
    isLoading,
    loadMore,
    loadingMore,
    hasMore,
  };
};

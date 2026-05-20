import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { RunSession } from "../../types/runSession";
import { useRoomSubscriptions } from "../socket/useSubscription";
import { applyRunsEvent, runKey, type RunsEvent } from "./runEvents";

/** One page of runs from a REST endpoint. */
export interface LiveRunsPage {
  runs: RunSession[];
  total: number;
}

export interface UseLiveRunsOptions {
  /**
   * Identifies the subject whose runs these are — a host, a chat thread, an
   * agent. Used as the React Query cache key, so callers must namespace it
   * (`host:…`, `thread:…`) to keep unrelated subjects from colliding. `null`
   * disables the hook entirely: no fetch, no subscriptions, empty list.
   */
  resetKey: string | null;
  /** Fetch one (1-based) page of runs; resolves to `null` on failure. */
  fetchPage: (page: number) => Promise<LiveRunsPage | null>;
  /**
   * Reconcile when a heartbeat names a new online run not in the list
   * (default false). A `runs:` room also carries that user's runs from
   * outside this list's filter, so enable this only where a new in-filter run
   * has no other way to announce itself — e.g. a host page. Sub-rows of an
   * already-loaded run are pulled in regardless; see `handleRunsEvent`.
   */
  pullNewRuns?: boolean;
}

export interface UseLiveRunsResult {
  runs: RunSession[];
  total: number;
  isLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  /** Re-pull every loaded page, reconciling against the server. */
  refetch: () => void;
  patchRun: (
    userId: number,
    runId: number,
    sessionId: number,
    subagentId: number | null | undefined,
    patch: Partial<RunSession>,
  ) => void;
}

type RunsInfiniteData = InfiniteData<LiveRunsPage, number>;

/** Return a copy of `data` with `update` applied to the run matching `key`. */
function updateRun(
  data: RunsInfiniteData | undefined,
  key: string,
  update: (run: RunSession) => RunSession,
): RunsInfiniteData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      runs: page.runs.map((run) => (runKey(run) === key ? update(run) : run)),
    })),
  };
}

/**
 * A live, paginated list of run sessions, backed by React Query. Pages are
 * fetched over REST; `runs:${username}` socket rooms keep them current —
 * heartbeats flip online/offline and paused/state, log/cost deltas accumulate
 * — merged straight into the query cache.
 *
 * Reconciliation is a query invalidation: on a heartbeat for an unloaded run
 * (see `pullNewRuns`), and app-wide on socket reconnect.
 */
export function useLiveRuns(options: UseLiveRunsOptions): UseLiveRunsResult {
  const { resetKey, fetchPage, pullNewRuns = false } = options;
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => ["live-runs", resetKey] as const, [resetKey]);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await fetchPage(pageParam);
      if (!page) throw new Error("useLiveRuns: page fetch failed");
      // REST carries no paused/state — they arrive only on heartbeats, so a
      // refetch keeps them from the run already in cache instead of wiping.
      const cached = queryClient.getQueryData<RunsInfiniteData>(queryKey);
      if (!cached) return page;
      const prev = new Map(
        cached.pages.flatMap((p) => p.runs).map((r) => [runKey(r), r] as const),
      );
      return {
        ...page,
        runs: page.runs.map((run) => {
          const old = prev.get(runKey(run));
          return old ? { ...run, paused: old.paused, state: old.state } : run;
        }),
      };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      allPages.reduce((n, p) => n + p.runs.length, 0) < lastPage.total
        ? allPages.length + 1
        : undefined,
    enabled: resetKey !== null,
    // The socket keeps loaded runs fresh; refetch on mount reconciles whatever
    // was missed while this hook was unmounted (and so unsubscribed).
    refetchOnMount: "always",
  });

  const runs = useMemo(
    () => query.data?.pages.flatMap((page) => page.runs) ?? [],
    [query.data],
  );

  // Run keys already reconciled for once — including out-of-filter runs that
  // merely share a `runs:` room with this list. Stops one from invalidating
  // on every heartbeat. Cleared when the subject changes.
  const reconciledUnknownKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    reconciledUnknownKeysRef.current = new Set();
  }, [resetKey]);

  const handleRunsEvent = useCallback(
    (event: RunsEvent) => {
      const key = runKey(event);
      const data = queryClient.getQueryData<RunsInfiniteData>(queryKey);
      const loaded = data?.pages.flatMap((p) => p.runs) ?? [];

      if (loaded.some((run) => runKey(run) === key)) {
        queryClient.setQueryData<RunsInfiniteData>(queryKey, (old) =>
          updateRun(old, key, (run) => applyRunsEvent(run, event)),
        );
        return;
      }

      // An unknown run — its `runs:` room also carries the user's runs from
      // outside this list's filter, so reconcile selectively, once per run:
      //  - a sub-row of a loaded run belongs here whatever event named it (a
      //    short-lived subagent may surface only via a log delta), so any
      //    event type pulls it in;
      //  - a wholly new run only when `pullNewRuns` is set, off an online
      //    heartbeat — its reliable announce signal.
      if (reconciledUnknownKeysRef.current.has(key)) return;
      const isRowOfLoadedRun = loaded.some(
        (run) => run.userId === event.userId && run.runId === event.runId,
      );
      const shouldReconcile =
        isRowOfLoadedRun ||
        (pullNewRuns && event.type === "heartbeat-update" && event.online);
      if (shouldReconcile) {
        reconciledUnknownKeysRef.current.add(key);
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient, queryKey, pullNewRuns],
  );

  const subscriptionEntries = useMemo(() => {
    if (resetKey === null) return [];
    const rooms = new Set<string>();
    for (const run of runs) {
      if (run.username) rooms.add(`runs:${run.username}`);
    }
    return [...rooms].map((room) => ({ room, onMessage: handleRunsEvent }));
  }, [resetKey, runs, handleRunsEvent]);

  useRoomSubscriptions<RunsEvent>(subscriptionEntries);

  const patchRun = useCallback<UseLiveRunsResult["patchRun"]>(
    (userId, runId, sessionId, subagentId, patch) => {
      const key = runKey({ userId, runId, subagentId, sessionId });
      queryClient.setQueryData<RunsInfiniteData>(queryKey, (old) =>
        updateRun(old, key, (run) => ({ ...run, ...patch })),
      );
    },
    [queryClient, queryKey],
  );

  const { fetchNextPage } = query;
  const loadMore = useCallback(async () => {
    await fetchNextPage();
  }, [fetchNextPage]);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    runs,
    total: query.data?.pages.at(-1)?.total ?? 0,
    isLoading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore,
    refetch,
    patchRun,
  };
}

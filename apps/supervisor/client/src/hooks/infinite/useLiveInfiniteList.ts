import type { HateoasAction } from "@naisys/common";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  countItems,
  flattenItems,
  type ListInfiniteData,
  type ListPage,
  mergeSocketItemsIntoPage,
} from "./pageCache";

type ItemKey = string | number;

export interface UseLiveInfiniteListOptions<TItem> {
  /** React Query cache key — build it via `queryKeys` and memoize it. */
  queryKey: readonly unknown[];
  enabled: boolean;
  /** Fetch one (1-based) page and normalize it to a `ListPage`. */
  fetchPage: (page: number) => Promise<ListPage<TItem>>;
  // getItemKey/getRecency/getSortValue feed a `useMemo` dependency list —
  // pass module-level constants so the derived `items` stays referentially
  // stable across renders.
  /** Stable dedup identity — an id, a participants string. */
  getItemKey: (item: TItem) => ItemKey;
  /** Higher means newer — resolves socket-vs-REST and same-key collisions. */
  getRecency: (item: TItem) => number;
  /** Display sort key. */
  getSortValue: (item: TItem) => number;
  /** Sort newest-first when true. */
  descending: boolean;
}

export interface UseLiveInfiniteListResult<TItem> {
  items: TItem[];
  total: number;
  actions: HateoasAction[] | undefined;
  isLoading: boolean;
  isFetchedAfterMount: boolean;
  error: Error | null;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  hasMore: boolean;
  /** Drop every cached page and refetch — for when the list is emptied
   *  server-side (archive-all) so stale rows can't merge forward. */
  refresh: () => Promise<void>;
}

/**
 * A live, paginated list backed by React Query's `useInfiniteQuery`. Pages are
 * fetched over REST and normalized to `ListPage`s; page 1 reconciles forward
 * any socket pushes the caller folded into the cache, so a refetch can't
 * revert them. The caller owns the socket subscription and its `setQueryData`
 * writes (the `pageCache` helpers do the cache surgery); this hook owns
 * pagination, flattening, and the refetch policy. Reconnect recovery is
 * app-wide via `useReconnectQueryRefresh`.
 */
export function useLiveInfiniteList<TItem>(
  options: UseLiveInfiniteListOptions<TItem>,
): UseLiveInfiniteListResult<TItem> {
  const {
    queryKey,
    enabled,
    fetchPage,
    getItemKey,
    getRecency,
    getSortValue,
    descending,
  } = options;
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await fetchPage(pageParam);
      // Page 1 is where socket pushes land — merge them forward so this fetch
      // can't clobber a push that beat it.
      if (pageParam !== 1) return page;
      const cached =
        queryClient.getQueryData<ListInfiniteData<TItem>>(queryKey)?.pages[0]
          ?.items ?? [];
      const { items, carried } = mergeSocketItemsIntoPage(
        page.items,
        cached,
        getItemKey,
        getRecency,
      );
      return { ...page, items, total: page.total + carried };
    },
    initialPageParam: 1,
    getNextPageParam: (_lastPage, allPages) => {
      const total = allPages[0]?.total ?? 0;
      return countItems(allPages, getItemKey) < total
        ? allPages.length + 1
        : undefined;
    },
    enabled,
    // Refetch on focus/mount to reconcile whatever the socket missed while
    // this hook was backgrounded or unmounted; the query fn merges cached
    // socket updates forward, so a refetch can't revert them. Gated by
    // staleTime rather than forced — a `useInfiniteQuery` refetch re-runs
    // every loaded page, too costly to pay on every quick remount.
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: 3,
    retryDelay: 1000,
  });

  const items = useMemo(
    () =>
      flattenItems(
        query.data?.pages ?? [],
        getItemKey,
        getRecency,
        getSortValue,
        descending,
      ),
    [query.data, getItemKey, getRecency, getSortValue, descending],
  );

  const { fetchNextPage } = query;
  const loadMore = useCallback(async () => {
    await fetchNextPage();
  }, [fetchNextPage]);

  const refresh = useCallback(async () => {
    await queryClient.resetQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    items,
    total: query.data?.pages[0]?.total ?? 0,
    actions: query.data?.pages[0]?.actions,
    isLoading: query.isLoading,
    isFetchedAfterMount: query.isFetchedAfterMount,
    error: query.error,
    loadMore,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    refresh,
  };
}

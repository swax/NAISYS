import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useGapRecovery } from "../socket/useGapRecovery";
import type { ListInfiniteData } from "./pageCache";

/**
 * Gap recovery for a `useLiveInfiniteList` message thread. A `new-message`
 * push carries the id of the message before it; when that id is absent from
 * the cached pages a push was dropped, so the thread reconciles with a
 * refetch. Each distinct gap is recovered at most once (see `useGapRecovery`).
 *
 * Returns `checkGap(previousMessageId, currentMessageId)` — call it for every
 * `new-message` push. It no-ops when there is no gap, when nothing is loaded
 * yet, or when `previousMessageId` is null.
 */
export function useInfiniteListGapRecovery<TItem>(
  queryKey: readonly unknown[],
  getItemId: (item: TItem) => number,
  logLabel: string,
): (previousMessageId: number | null, currentMessageId: number) => void {
  const queryClient = useQueryClient();
  const markGapRecovered = useGapRecovery(queryKey);

  return useCallback(
    (previousMessageId: number | null, currentMessageId: number) => {
      if (previousMessageId == null) return;
      const loaded = queryClient
        .getQueryData<ListInfiniteData<TItem>>(queryKey)
        ?.pages.flatMap((page) => page.items);
      // Nothing loaded yet — the initial fetch will pull this message in.
      if (!loaded || loaded.length === 0) return;
      if (loaded.some((item) => getItemId(item) === previousMessageId)) return;
      if (!markGapRecovered(`${previousMessageId}-${currentMessageId}`)) return;
      console.warn(
        `[${logLabel}] Gap detected: missing message ${previousMessageId}, refetching`,
      );
      void queryClient.invalidateQueries({ queryKey });
    },
    [queryClient, queryKey, getItemId, markGapRecovered, logLabel],
  );
}

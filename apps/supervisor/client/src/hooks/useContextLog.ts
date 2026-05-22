import { mergeByKey, sortBy } from "@naisys/common";
import type { LogPushEntry } from "@naisys/hub-protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { LogEntry } from "../lib/api/apiClient";
import { getContextLog } from "../lib/api/apiRuns";
import { queryKeys } from "../lib/api/queryKeys";
import { useAgentLookups } from "./data/useAgentLookups";
import { useGapRecovery } from "./socket/useGapRecovery";
import { useSubscription } from "./socket/useSubscription";

/** Merge incoming log entries into the accumulated list, deduped by id and
 *  sorted ascending. Returns the original array when there is nothing new. */
export function mergeLogEntries(
  existing: LogEntry[],
  incoming: LogEntry[],
): LogEntry[] {
  if (incoming.length === 0) return existing;
  // Live runs stream sorted appends — skip the dedupe + full re-sort when
  // every incoming id is past what we already hold.
  const maxId = existing.length ? existing[existing.length - 1].id : 0;
  if (incoming.every((log) => log.id > maxId)) {
    return [...existing, ...sortBy(incoming, (log) => log.id)];
  }
  // Gap recovery splices in an older range — dedupe by id, then re-sort.
  return sortBy(
    mergeByKey(existing, incoming, (log) => log.id),
    (log) => log.id,
  );
}

/** Stable empty reference so `logs` keeps a constant identity while loading. */
const EMPTY_LOGS: LogEntry[] = [];

/**
 * The context log for one run session, backed by React Query. The query cache
 * holds the accumulated, id-sorted `LogEntry[]`; the `logsAfter` cursor is the
 * highest id already cached, so every fetch (mount, focus, reconnect) is an
 * incremental catch-up. While the run is online a `logs:` socket room streams
 * pushes straight into the cache; a missing `previousId` means a push was
 * dropped, so a bounded range-fetch fills the gap.
 */
export const useContextLog = (
  agentUsername: string,
  runId: number,
  sessionId: number,
  enabled: boolean = true,
  isOnline: boolean = false,
  subagentId: number | null = null,
) => {
  const { userLookup } = useAgentLookups();
  const queryClient = useQueryClient();

  // Subagent sessions share their parent's username + runId; the discriminator
  // is the subagentId. Bake it into the query key so subagents don't collide
  // with the parent (or each other) in the cache.
  const subagentKey = subagentId ?? 0;
  const sessionKey = `${agentUsername}-${runId}-${subagentKey}-${sessionId}`;
  const queryKey = useMemo(
    () => queryKeys.contextLog(sessionKey),
    [sessionKey],
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      // The cursor is the highest id we already hold — fetch only what's new.
      const before = queryClient.getQueryData<LogEntry[]>(queryKey) ?? [];
      const logsAfter = before.length
        ? before[before.length - 1].id
        : undefined;
      const result = await getContextLog({
        agentUsername,
        runId,
        sessionId,
        subagentId,
        logsAfter,
      });
      const delta = result.success && result.data ? result.data.logs : [];
      // A socket push may have merged entries in while the fetch was in flight.
      const current = queryClient.getQueryData<LogEntry[]>(queryKey) ?? before;
      return mergeLogEntries(current, delta);
    },
    enabled: enabled && !!agentUsername,
    refetchOnWindowFocus: !isOnline,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: 1000,
  });

  const markGapRecovered = useGapRecovery(queryKey);

  // Fetch a bounded range of missing logs to fill a detected gap.
  const recoverGap = useCallback(
    async (gapPreviousId: number, gapFirstId: number) => {
      const gapKey = `${gapPreviousId}-${gapFirstId}`;
      if (!markGapRecovered(gapKey)) return;

      try {
        // Narrow the range to just below the gap with the highest id we hold.
        const current = queryClient.getQueryData<LogEntry[]>(queryKey) ?? [];
        const logsBeforeGap = current.filter((l) => l.id < gapFirstId);
        const rangeStart =
          logsBeforeGap.length > 0
            ? logsBeforeGap[logsBeforeGap.length - 1].id
            : undefined;

        const result = await getContextLog({
          agentUsername,
          runId,
          sessionId,
          subagentId,
          logsAfter: rangeStart,
          logsBefore: gapFirstId,
        });
        if (result.success && result.data) {
          const recovered = result.data.logs;
          console.info(
            `[useContextLog] Gap recovery for ${sessionKey}: fetched ${recovered.length} logs (after=${rangeStart}, before=${gapFirstId})`,
          );
          queryClient.setQueryData<LogEntry[]>(queryKey, (old) =>
            mergeLogEntries(old ?? [], recovered),
          );
        }
      } catch (err) {
        console.error(
          `[useContextLog] Gap recovery failed for ${sessionKey}:`,
          err,
        );
      }
    },
    [
      agentUsername,
      runId,
      sessionId,
      subagentId,
      sessionKey,
      queryClient,
      queryKey,
      markGapRecovered,
    ],
  );

  // Handle push entries: resolve userId to username from agent context.
  const handlePushEntries = useCallback(
    (entries: (LogPushEntry & { attachmentDownloadUrl?: string })[]) => {
      const logs: LogEntry[] = entries.map((e) => ({
        id: e.id,
        username: userLookup.get(e.userId) ?? String(e.userId),
        role: e.role as LogEntry["role"],
        source: e.source as LogEntry["source"],
        type: e.type as LogEntry["type"],
        message: e.message,
        createdAt: e.createdAt,
        attachment: e.attachmentId
          ? {
              id: e.attachmentId,
              filename: e.attachmentFilename ?? "",
              fileSize: e.attachmentFileSize ?? 0,
              downloadUrl: e.attachmentDownloadUrl ?? "",
            }
          : undefined,
      }));
      queryClient.setQueryData<LogEntry[]>(queryKey, (old) =>
        mergeLogEntries(old ?? [], logs),
      );

      // Gap detection: the first entry's previousId should already be cached.
      const firstEntry = entries[0];
      if (firstEntry?.previousId != null) {
        const current = queryClient.getQueryData<LogEntry[]>(queryKey);
        if (
          current &&
          current.length > 0 &&
          !current.some((l) => l.id === firstEntry.previousId)
        ) {
          console.warn(
            `[useContextLog] Gap detected in ${sessionKey}: missing previousId ${firstEntry.previousId}, recovering before id ${firstEntry.id}`,
          );
          void recoverGap(firstEntry.previousId, firstEntry.id);
        }
      }
    },
    [queryClient, queryKey, userLookup, sessionKey, recoverGap],
  );

  useSubscription<LogPushEntry[]>(
    isOnline && enabled && agentUsername
      ? `logs:${agentUsername}:${runId}:${subagentKey}:${sessionId}`
      : null,
    handlePushEntries,
  );

  const logs = query.data ?? EMPTY_LOGS;

  return {
    logs,
    isLoading: query.isLoading,
    error: query.error,
  };
};

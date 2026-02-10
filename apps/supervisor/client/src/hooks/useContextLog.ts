import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ContextLogParams, getContextLog, LogEntry } from "../lib/apiClient";

// Module-level caches (shared across all hook instances and persist across remounts)
const logsCache = new Map<string, LogEntry[]>();
const logsAfterCache = new Map<string, number | undefined>();

export const useContextLog = (
  userId: number,
  runId: number,
  sessionId: number,
  enabled: boolean = true,
  isOnline: boolean = false,
) => {
  // Create a unique key for this session
  const sessionKey = `${userId}-${runId}-${sessionId}`;
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const queryFn = useCallback(
    async ({ queryKey }: any) => {
      const [, sessionKey] = queryKey;

      const params: ContextLogParams = {
        userId,
        runId,
        sessionId,
        logsAfter: logsAfterCache.get(sessionKey),
      };

      return await getContextLog(params);
    },
    [userId, runId, sessionId],
  );

  const query = useQuery({
    queryKey: ["context-log", sessionKey],
    queryFn,
    enabled: enabled && !!userId,
    refetchInterval: isOnline ? 5000 : false, // Only poll if online
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always", // Immediate update when userId changes
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const newLogs = query.data.data.logs;

      const existingLogs = logsCache.get(sessionKey) || [];

      // Create a map of existing logs for quick lookup
      const logsMap = new Map(
        existingLogs.map((log: LogEntry) => [log.id, log]),
      );

      // Update existing logs and add new ones
      newLogs.forEach((log) => {
        logsMap.set(log.id, log);
      });

      const mergedLogs = Array.from(logsMap.values());

      // Sort once when updating cache (ascending - oldest first)
      const sortedLogs = mergedLogs.sort((a, b) => a.id - b.id);

      // Update cache with sorted logs
      logsCache.set(sessionKey, sortedLogs);

      // Update logsAfter with the highest log ID we've seen
      if (sortedLogs.length > 0) {
        const maxLogId = sortedLogs.reduce(
          (max, log) => (log.id > max ? log.id : max),
          sortedLogs[0].id,
        );
        logsAfterCache.set(sessionKey, maxLogId);
      }

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, sessionKey]);

  // Get current logs from cache (already sorted)
  const logs = logsCache.get(sessionKey) || [];

  return {
    logs,
    isLoading: query.isLoading,
    error: query.error,
  };
};

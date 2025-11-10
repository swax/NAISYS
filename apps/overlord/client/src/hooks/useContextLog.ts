import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextLogParams, getContextLog, LogEntry } from "../lib/apiClient";

export const useContextLog = (
  userId: number,
  runId: number,
  sessionId: number,
  enabled: boolean = true,
  isOnline: boolean = false,
) => {
  // Create a unique key for this session
  const sessionKey = `${userId}-${runId}-${sessionId}`;

  // Store merged logs per session
  const logsCache = useRef<Map<string, LogEntry[]>>(new Map());
  // Store logsAfter per session
  const logsAfterCache = useRef<Map<string, number | undefined>>(new Map());
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const queryFn = useCallback(
    async ({ queryKey }: any) => {
      const [, sessionKey] = queryKey;

      const params: ContextLogParams = {
        userId,
        runId,
        sessionId,
        logsAfter: logsAfterCache.current.get(sessionKey),
      };

      return await getContextLog(params);
    },
    [userId, runId, sessionId],
  );

  const query = useQuery({
    queryKey: ["context-log", sessionKey],
    queryFn,
    enabled: enabled && userId > 0,
    refetchInterval: isOnline ? 5000 : false, // Only poll if online
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const newLogs = query.data.data.logs;

      const existingLogs = logsCache.current.get(sessionKey) || [];

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
      logsCache.current.set(sessionKey, sortedLogs);

      // Update logsAfter with the highest log ID we've seen
      if (sortedLogs.length > 0) {
        const maxLogId = Math.max(...sortedLogs.map((log) => log.id));
        logsAfterCache.current.set(sessionKey, maxLogId);
      }

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data, sessionKey]);

  // Get current logs from cache (already sorted)
  const logs = logsCache.current.get(sessionKey) || [];

  return {
    logs,
    isLoading: query.isLoading,
    error: query.error,
  };
};

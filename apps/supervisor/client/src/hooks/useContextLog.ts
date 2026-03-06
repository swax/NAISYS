import type { LogPushEntry } from "@naisys/hub-protocol";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { LogEntry } from "../lib/apiClient";
import { ContextLogParams, getContextLog } from "../lib/apiRuns";
import { useSubscription } from "./useSubscription";

// Module-level caches (shared across all hook instances and persist across remounts)
const logsCache = new Map<string, LogEntry[]>();
const logsAfterCache = new Map<string, number | undefined>();

export const useContextLog = (
  agentUsername: string,
  runId: number,
  sessionId: number,
  enabled: boolean = true,
  isOnline: boolean = false,
) => {
  const { agents } = useAgentDataContext();
  const userLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );

  // Create a unique key for this session
  const sessionKey = `${agentUsername}-${runId}-${sessionId}`;
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const mergeLogs = useCallback(
    (newLogs: LogEntry[]) => {
      if (newLogs.length === 0) return;

      const existingLogs = logsCache.get(sessionKey) || [];

      const logsMap = new Map(
        existingLogs.map((log: LogEntry) => [log.id, log]),
      );

      newLogs.forEach((log) => {
        logsMap.set(log.id, log);
      });

      const sortedLogs = Array.from(logsMap.values()).sort(
        (a, b) => a.id - b.id,
      );

      logsCache.set(sessionKey, sortedLogs);

      if (sortedLogs.length > 0) {
        const maxLogId = sortedLogs[sortedLogs.length - 1].id;
        logsAfterCache.set(sessionKey, maxLogId);
      }

      setCacheVersion((v) => v + 1);
    },
    [sessionKey],
  );

  // Handle push entries: resolve userId to username from agent context
  const handlePushEntries = useCallback(
    (entries: LogPushEntry[]) => {
      const logs: LogEntry[] = entries.map((e) => ({
        id: e.id,
        username: userLookup.get(e.userId) ?? String(e.userId),
        role: e.role as LogEntry["role"],
        source: e.source as LogEntry["source"],
        type: e.type as LogEntry["type"],
        message: e.message,
        createdAt: e.createdAt,
        attachment: e.attachmentId
          ? { id: e.attachmentId, filename: "", fileSize: 0 }
          : undefined,
      }));
      mergeLogs(logs);
    },
    [mergeLogs, userLookup],
  );

  const queryFn = useCallback(
    async ({ queryKey }: any) => {
      const [, sessionKey] = queryKey;

      const params: ContextLogParams = {
        agentUsername,
        runId,
        sessionId,
        logsAfter: logsAfterCache.get(sessionKey),
      };

      return await getContextLog(params);
    },
    [agentUsername, runId, sessionId],
  );

  const query = useQuery({
    queryKey: ["context-log", sessionKey],
    queryFn,
    enabled: enabled && !!agentUsername,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: !isOnline,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: 1000,
  });

  // Merge REST data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      mergeLogs(query.data.data.logs);
    }
  }, [query.data, mergeLogs]);

  // WebSocket subscription for real-time log updates when online
  useSubscription<LogPushEntry[]>(
    isOnline && enabled && agentUsername
      ? `logs:${agentUsername}:${runId}:${sessionId}`
      : null,
    handlePushEntries,
  );

  // Get current logs from cache (already sorted)
  const logs = logsCache.get(sessionKey) || [];

  return {
    logs,
    isLoading: query.isLoading,
    error: query.error,
  };
};

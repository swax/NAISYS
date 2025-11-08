import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { ContextLogParams, getContextLog } from "../lib/apiClient";

export const useContextLog = (
  userId: number,
  runId: number,
  sessionId: number,
  enabled: boolean = true,
  isOnline: boolean = false,
) => {
  const queryFn = useCallback(
    async ({ queryKey }: any) => {
      const [, userId, runId, sessionId, logsAfter] = queryKey;

      const params: ContextLogParams = {
        userId,
        runId,
        sessionId,
        logsAfter,
      };

      return await getContextLog(params);
    },
    [],
  );

  return useQuery({
    queryKey: ["context-log", userId, runId, sessionId, undefined],
    queryFn,
    enabled: enabled && userId > 0,
    refetchInterval: isOnline ? 5000 : false, // Only poll if online
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });
};

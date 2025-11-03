import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getNaisysData, NaisysDataParams } from "../lib/apiClient";

export const useNaisysData = (
  cacheInitialized: boolean = false,
  lastLogId: number = -1,
  lastMailId: number = -1,
) => {
  const queryFn = useCallback(async () => {
    const params: NaisysDataParams = {
      logsAfter: lastLogId,
      logsLimit: 10000,
      mailAfter: lastMailId,
      mailLimit: 1000,
    };

    return await getNaisysData(params);
  }, [lastLogId, lastMailId]);

  return useQuery({
    queryKey: ["naisys-data"],
    queryFn,
    enabled: cacheInitialized, // Only start polling when cache is initialized
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });
};

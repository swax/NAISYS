import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getRunsData, RunsDataParams } from "../lib/apiClient";

export const useRunsData = (userId: number, enabled: boolean = true) => {
  const queryFn = useCallback(async ({ queryKey }: any) => {
    const [, userId, updatedSince] = queryKey;

    const params: RunsDataParams = {
      userId,
      updatedSince,
    };

    return await getRunsData(params);
  }, []);

  return useQuery({
    queryKey: ["runs-data", userId, undefined],
    queryFn,
    enabled: enabled && userId > 0,
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });
};

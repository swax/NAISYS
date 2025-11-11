import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getAgentData } from "../lib/apiClient";

export const useAgentData = () => {
  const queryFn = useCallback(async () => {
    return await getAgentData();
  }, []);

  return useQuery({
    queryKey: ["agent-data"],
    queryFn,
    enabled: true,
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });
};

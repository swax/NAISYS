import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getNaisysData } from "../lib/apiClient";

export const useNaisysData = () => {
  const queryFn = useCallback(async () => {
    return await getNaisysData();
  }, []);

  return useQuery({
    queryKey: ["naisys-data"],
    queryFn,
    enabled: true,
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });
};

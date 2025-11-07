import { useQuery } from "@tanstack/react-query";
import { api, apiEndpoints, HelloResponse } from "../lib/apiClient";

export function useHello() {
  return useQuery<HelloResponse, Error>({
    queryKey: ["hello"],
    queryFn: () => api.get<HelloResponse>(apiEndpoints.hello),
  });
}

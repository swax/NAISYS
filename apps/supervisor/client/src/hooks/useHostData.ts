import { isAgentOnline } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Host as BaseHost } from "@naisys-supervisor/shared";
import { getHostData } from "../lib/apiClient";
import { Host } from "../types/agent";

// Module-level cache (shared across all hook instances and persists across remounts)
let hostCache: Host[] = [];

export const useHostData = () => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const query = useQuery({
    queryKey: ["host-data"],
    queryFn: getHostData,
    enabled: true,
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: 1000,
  });

  // Update cache when data arrives
  useEffect(() => {
    if (query.data?.items) {
      const hostsWithOnline: Host[] = query.data.items.map(
        (host: BaseHost) => ({
          ...host,
          online: isAgentOnline(
            host.lastActive ?? undefined,
            query.dataUpdatedAt,
          ),
        }),
      );

      // Sort by name
      const sortedHosts = hostsWithOnline.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      hostCache = sortedHosts;

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data]);

  const hosts = hostCache;

  return {
    hosts,
    isLoading: query.isLoading,
    error: query.error,
  };
};

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { AgentStatusEvent, Host as BaseHost } from "@naisys-supervisor/shared";
import { getHostData } from "../lib/apiAgents";
import { Host } from "../types/agent";
import { useAgentStatusStream } from "./useAgentStatusStream";

// Module-level cache (shared across all hook instances and persists across remounts)
let hostCache: Host[] = [];

export const useHostData = () => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

  const query = useQuery({
    queryKey: ["host-data"],
    queryFn: getHostData,
    enabled: true,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Update cache when data arrives
  useEffect(() => {
    if (query.data?.items) {
      const hostsWithOnline: Host[] = query.data.items.map(
        (host: BaseHost) => ({
          ...host,
          online: host.online ?? false,
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

  // Handle SSE updates for host online status
  const handleSSEUpdate = useCallback((event: AgentStatusEvent) => {
    if (!event.hosts) return;

    let changed = false;

    for (const host of hostCache) {
      const update = event.hosts[String(host.id)];
      if (!update) continue;

      if (host.online !== update.online) {
        host.online = update.online;
        changed = true;
      }
    }

    if (changed) {
      setCacheVersion((v) => v + 1);
    }
  }, []);

  useAgentStatusStream(handleSSEUpdate, hostCache.length > 0);

  const hosts = hostCache;

  return {
    hosts,
    isLoading: query.isLoading,
    error: query.error,
  };
};

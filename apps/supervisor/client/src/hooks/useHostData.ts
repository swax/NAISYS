import type { HateoasAction } from "@naisys/common";
import type {
  Host as BaseHost,
  HostStatusEvent,
} from "@naisys/supervisor-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "../contexts/SessionContext";
import { getHostData } from "../lib/apiAgents";
import type { Host } from "../types/agent";
import { useSubscription } from "./useSubscription";

// Module-level cache (shared across all hook instances and persists across remounts)
let hostCache: Host[] = [];
let listActionsCache: HateoasAction[] | undefined;
let targetVersionCache: string | undefined;

export const useHostData = () => {
  const { isAuthenticated } = useSession();
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["host-data"],
    queryFn: getHostData,
    enabled: true,
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
      listActionsCache = query.data._actions;
      targetVersionCache = query.data.targetVersion;

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data]);

  // Handle WebSocket updates for host online status and list changes
  const handleStatusUpdate = useCallback(
    (event: HostStatusEvent) => {
      // Host list changed (create/update/delete/topology change) — refetch
      if (event.hostsListChanged) {
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        return;
      }

      let changed = false;

      for (const host of hostCache) {
        const update = event.hosts[String(host.id)];
        if (!update) continue;

        if (host.online !== update.online) {
          host.online = update.online;
          changed = true;
        }
        if (update.version !== undefined && host.version !== update.version) {
          host.version = update.version;
          changed = true;
        }
      }

      if (changed) {
        setCacheVersion((v) => v + 1);
      }
    },
    [queryClient],
  );

  useSubscription<HostStatusEvent>(
    isAuthenticated ? "host-status" : null,
    handleStatusUpdate,
  );

  return {
    hosts: hostCache,
    listActions: listActionsCache,
    targetVersion: targetVersionCache,
    isLoading: query.isLoading,
    error: query.error,
  };
};

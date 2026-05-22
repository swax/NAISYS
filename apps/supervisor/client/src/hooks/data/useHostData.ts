import { type HateoasAction, sortBy } from "@naisys/common";
import type { HostStatusEvent } from "@naisys/supervisor-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useSession } from "../../contexts/SessionContext";
import { getHostData } from "../../lib/api/apiAgents";
import type { HostListResponse } from "../../lib/api/apiClient";
import { queryKeys } from "../../lib/api/queryKeys";
import type { Host } from "../../types/agent";
import { useSubscription } from "../socket/useSubscription";

/**
 * The host roster, backed by React Query. The query cache holds the raw server
 * response; the `host-status` socket room folds online/version changes
 * straight into it via `setQueryData`, and a topology change triggers a
 * reconciling refetch. Reconnect recovery is app-wide via
 * `useReconnectQueryRefresh`.
 */
export const useHostData = () => {
  const { isAuthenticated } = useSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.hostData,
    queryFn: getHostData,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const hosts = useMemo<Host[]>(() => {
    const withOnline = (query.data?.items ?? []).map((host) => ({
      ...host,
      online: host.online ?? false,
    }));
    return sortBy(withOnline, (host) => host.name);
  }, [query.data]);

  const listActions: HateoasAction[] | undefined = query.data?._actions;
  const targetVersion = query.data?.targetVersion;

  const handleStatusUpdate = useCallback(
    (event: HostStatusEvent) => {
      // Topology changed (create/update/delete) — refetch.
      if (event.hostsListChanged) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.hostData });
        return;
      }
      queryClient.setQueryData<HostListResponse>(queryKeys.hostData, (old) => {
        if (!old?.items) return old;
        let changed = false;
        const items = old.items.map((host) => {
          const update = event.hosts[String(host.id)];
          if (!update) return host;
          const nextVersion =
            update.version !== undefined ? update.version : host.version;
          if (host.online !== update.online || host.version !== nextVersion) {
            changed = true;
            return { ...host, online: update.online, version: nextVersion };
          }
          return host;
        });
        return changed ? { ...old, items } : old;
      });
    },
    [queryClient],
  );

  useSubscription<HostStatusEvent>(
    isAuthenticated ? "host-status" : null,
    handleStatusUpdate,
  );

  return {
    hosts,
    listActions,
    targetVersion,
    isLoading: query.isLoading,
    error: query.error,
  };
};

import { type HateoasAction, sortBy } from "@naisys/common";
import type { AgentStatusEvent } from "@naisys/supervisor-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useSession } from "../../contexts/SessionContext";
import { getAgentData } from "../../lib/api/apiAgents";
import type { AgentListResponse } from "../../lib/api/apiClient";
import { queryKeys } from "../../lib/api/queryKeys";
import type { Agent } from "../../types/agent";
import { useSubscription } from "../socket/useSubscription";

/**
 * The agent roster, backed by React Query. The query cache holds the raw
 * server response; the `agent-status` socket room folds fast-changing fields
 * (status, latestLogId, latestMailId) straight into it via `setQueryData`, and
 * a list-membership change triggers a reconciling refetch. Every fetch pulls
 * the full list, so a deleted agent can't linger; reconnect recovery is
 * app-wide via `useReconnectQueryRefresh`.
 */
export const useAgentData = () => {
  const { isAuthenticated } = useSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.agentData,
    queryFn: () => getAgentData(),
    refetchOnWindowFocus: true,
    retry: false,
  });

  const agents = useMemo<Agent[]>(() => {
    const withStatus = (query.data?.items ?? []).map((agent) => ({
      ...agent,
      status: agent.status ?? "offline",
    }));
    return sortBy(withStatus, (agent) => agent.name);
  }, [query.data]);

  const actions: HateoasAction[] | undefined = query.data?._actions;

  const handleStatusUpdate = useCallback(
    (event: AgentStatusEvent) => {
      // List membership changed (create/archive/unarchive/delete) — refetch.
      if (event.agentsListChanged) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agentData });
        return;
      }
      queryClient.setQueryData<AgentListResponse>(queryKeys.agentData, (old) => {
        if (!old?.items) return old;
        let changed = false;
        const items = old.items.map((agent) => {
          const update = event.agents[String(agent.id)];
          if (!update) return agent;
          if (
            agent.status !== update.status ||
            agent.latestLogId !== update.latestLogId ||
            agent.latestMailId !== update.latestMailId
          ) {
            changed = true;
            return {
              ...agent,
              status: update.status,
              latestLogId: update.latestLogId,
              latestMailId: update.latestMailId,
            };
          }
          return agent;
        });
        return changed ? { ...old, items } : old;
      });
    },
    [queryClient],
  );

  useSubscription<AgentStatusEvent>(
    isAuthenticated ? "agent-status" : null,
    handleStatusUpdate,
  );

  return {
    agents,
    actions,
    isLoading: query.isLoading,
    error: query.error,
  };
};

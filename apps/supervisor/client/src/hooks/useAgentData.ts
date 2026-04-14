import type { HateoasAction } from "@naisys/common";
import type {
  Agent as BaseAgent,
  AgentStatusEvent,
} from "@naisys/supervisor-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "../contexts/SessionContext";
import { getAgentData } from "../lib/apiAgents";
import type { Agent } from "../types/agent";
import { useSubscription } from "./useSubscription";

// Module-level caches (shared across all hook instances and persist across remounts)
let agentCache: Agent[] = [];
let actionsCache: HateoasAction[] | undefined = undefined;
let updatedSinceCache: string | undefined = undefined;

export const useAgentData = () => {
  const { isAuthenticated } = useSession();
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);
  const queryClient = useQueryClient();

  const queryFn = useCallback(async () => {
    return await getAgentData({
      updatedSince: updatedSinceCache,
    });
  }, []);

  const query = useQuery({
    queryKey: ["agent-data"],
    queryFn,
    enabled: true,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.items) {
      const updatedAgents = query.data.items;

      let mergedAgents: BaseAgent[];

      if (updatedSinceCache === undefined) {
        // Full refetch — replace cache entirely (handles deletes)
        mergedAgents = updatedAgents;
      } else {
        // Incremental update — merge with existing cache
        const mergeMap = new Map<number, BaseAgent>(
          agentCache.map((agent: Agent) => [agent.id, agent]),
        );
        updatedAgents.forEach((agent: BaseAgent) => {
          mergeMap.set(agent.id, agent);
        });
        mergedAgents = Array.from(mergeMap.values());
      }

      const agentsWithStatus: Agent[] = mergedAgents.map((agent) => ({
        ...agent,
        status: agent.status ?? "offline",
      }));

      // Sort by name
      const sortedAgents = agentsWithStatus.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      // Update caches
      agentCache = sortedAgents;
      actionsCache = query.data._actions;

      // Update updatedSince with the current timestamp
      updatedSinceCache = new Date().toISOString();

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data]);

  // Handle WebSocket updates for fast-changing fields (status, latestLogId, latestMailId)
  const handleStatusUpdate = useCallback(
    (event: AgentStatusEvent) => {
      // Agent list changed (create/archive/unarchive/delete) — refetch full list
      if (event.agentsListChanged) {
        updatedSinceCache = undefined;
        void queryClient.invalidateQueries({ queryKey: ["agent-data"] });
        return;
      }

      let changed = false;

      for (const agent of agentCache) {
        const update = event.agents[String(agent.id)];
        if (!update) continue;

        const newStatus = update.status;
        const newLogId = update.latestLogId;
        const newMailId = update.latestMailId;

        if (
          agent.status !== newStatus ||
          agent.latestLogId !== newLogId ||
          agent.latestMailId !== newMailId
        ) {
          agent.status = newStatus;
          agent.latestLogId = newLogId;
          agent.latestMailId = newMailId;
          changed = true;
        }
      }

      if (changed) {
        setCacheVersion((v) => v + 1);
      }
    },
    [queryClient],
  );

  useSubscription<AgentStatusEvent>(
    isAuthenticated ? "agent-status" : null,
    handleStatusUpdate,
  );

  return {
    agents: agentCache,
    actions: actionsCache,
    isLoading: query.isLoading,
    error: query.error,
  };
};

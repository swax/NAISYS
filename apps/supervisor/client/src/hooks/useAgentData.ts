import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { HateoasAction } from "@naisys/common";
import {
  Agent as BaseAgent,
  AgentStatusEvent,
} from "@naisys-supervisor/shared";
import { getAgentData } from "../lib/apiAgents";
import { Agent } from "../types/agent";
import { useAgentStatusStream } from "./useAgentStatusStream";

// Module-level caches (shared across all hook instances and persist across remounts)
let agentCache: Agent[] = [];
let actionsCache: HateoasAction[] | undefined = undefined;
let updatedSinceCache: string | undefined = undefined;

export const useAgentData = () => {
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
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
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

      const agentsWithOnline: Agent[] = mergedAgents.map((agent) => ({
        ...agent,
        online: agent.online ?? false,
      }));

      // Sort by name
      const sortedAgents = agentsWithOnline.sort((a, b) =>
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

  // Handle SSE updates for fast-changing fields (online, latestLogId, latestMailId)
  const handleSSEUpdate = useCallback(
    (event: AgentStatusEvent) => {
      // Agent list changed (create/archive/unarchive/delete) — refetch full list
      if (event.listChanged) {
        updatedSinceCache = undefined;
        queryClient.invalidateQueries({ queryKey: ["agent-data"] });
        return;
      }

      let changed = false;

      for (const agent of agentCache) {
        const update = event.agents[String(agent.id)];
        if (!update) continue;

        const newOnline = update.online;
        const newLogId = update.latestLogId;
        const newMailId = update.latestMailId;

        if (
          agent.online !== newOnline ||
          agent.latestLogId !== newLogId ||
          agent.latestMailId !== newMailId
        ) {
          agent.online = newOnline;
          agent.latestLogId = newLogId;
          agent.latestMailId = newMailId;
          changed = true;
        }
      }

      if (changed) {
        setCacheVersion((v) => v + 1);
      }
    },
    [queryClient], // eslint-disable-line react-hooks/exhaustive-deps -- accesses module-level agentCache
  );

  useAgentStatusStream(handleSSEUpdate, agentCache.length > 0);

  return {
    agents: agentCache,
    actions: actionsCache,
    isLoading: query.isLoading,
    error: query.error,
  };
};

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Agent as BaseAgent, AgentStatusEvent } from "@naisys-supervisor/shared";
import { getAgentData } from "../lib/apiClient";
import { Agent } from "../types/agent";
import { useAgentStatusStream } from "./useAgentStatusStream";

// Module-level caches (shared across all hook instances and persist across remounts)
let agentCache: Agent[] = [];
let updatedSinceCache: string | undefined = undefined;

export const useAgentData = () => {
  // Version counter to trigger re-renders when cache updates
  const [, setCacheVersion] = useState(0);

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

      const existingAgents = agentCache;

      // Create a map of existing agents for quick lookup (using BaseAgent to allow updates)
      const mergeAgents = new Map<number, BaseAgent>(
        existingAgents.map((agent: Agent) => [agent.id, agent]),
      );

      // Update existing agents and add new ones
      updatedAgents.forEach((agent: BaseAgent) => {
        mergeAgents.set(agent.id, agent);
      });

      const mergedAgents = Array.from(mergeAgents.values());

      const agentsWithOnline: Agent[] = mergedAgents.map((agent) => ({
        ...agent,
        online: agent.online ?? false,
      }));

      // Sort by name
      const sortedAgents = agentsWithOnline.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      // Update cache with sorted agents
      agentCache = sortedAgents;

      // Update updatedSince with the current timestamp
      updatedSinceCache = new Date().toISOString();

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data]);

  // Handle SSE updates for fast-changing fields (online, latestLogId, latestMailId)
  const handleSSEUpdate = useCallback(
    (event: AgentStatusEvent) => {
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
    [], // eslint-disable-line react-hooks/exhaustive-deps -- accesses module-level agentCache
  );

  useAgentStatusStream(handleSSEUpdate, agentCache.length > 0);

  // Get current agents from cache (already sorted)
  const agents = agentCache;

  return {
    agents,
    isLoading: query.isLoading,
    error: query.error,
  };
};

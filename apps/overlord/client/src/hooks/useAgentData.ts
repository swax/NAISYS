import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { getAgentData, Agent } from "../lib/apiClient";

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
    refetchInterval: 5000, // Poll every 5 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const updatedAgents = query.data.data.agents;

      const existingAgents = agentCache;

      // Create a map of existing agents for quick lookup
      const mergeAgents = new Map(
        existingAgents.map((agent: Agent) => [agent.id, agent]),
      );

      // Update existing agents and add new ones
      updatedAgents.forEach((agent) => {
        mergeAgents.set(agent.id, agent);
      });

      const mergedAgents = Array.from(mergeAgents.values());

      // Sort by name
      const sortedAgents = mergedAgents.sort((a, b) =>
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

  // Get current agents from cache (already sorted)
  const agents = agentCache;

  return {
    agents,
    isLoading: query.isLoading,
    error: query.error,
  };
};

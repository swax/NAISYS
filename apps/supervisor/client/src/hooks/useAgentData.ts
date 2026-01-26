import { isAgentOnline } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Agent as BaseAgent, Host as BaseHost } from "shared";
import { getAgentData } from "../lib/apiClient";
import { Agent, Host } from "../types/agent";

// Module-level caches (shared across all hook instances and persist across remounts)
let agentCache: Agent[] = [];
let hostCache: Host[] = [];
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
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: 1000,
  });

  // Merge new data when it arrives
  useEffect(() => {
    if (query.data?.success && query.data.data) {
      const updatedAgents = query.data.data.agents;
      const updatedHosts = query.data.data.hosts;

      const existingAgents = agentCache;

      // Create a map of existing agents for quick lookup (using BaseAgent to allow updates)
      const mergeAgents = new Map<string, BaseAgent>(
        existingAgents.map((agent: Agent) => [agent.id, agent]),
      );

      // Update existing agents and add new ones
      updatedAgents.forEach((agent: BaseAgent) => {
        mergeAgents.set(agent.id, agent);
      });

      const mergedAgents = Array.from(mergeAgents.values());

      // Recalculate online status for all agents after merging
      const agentsWithOnline: Agent[] = mergedAgents.map((agent) => ({
        ...agent,
        online: isAgentOnline(agent.lastActive, query.dataUpdatedAt),
      }));

      // Sort by name
      const sortedAgents = agentsWithOnline.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      // Update cache with sorted agents
      agentCache = sortedAgents;

      // Process hosts - always replace (no merge needed since hosts don't have updatedSince filtering)
      const hostsWithOnline: Host[] = updatedHosts.map((host: BaseHost) => ({
        ...host,
        online: isAgentOnline(
          host.lastActive ?? undefined,
          query.dataUpdatedAt,
        ),
      }));

      // Sort by name
      const sortedHosts = hostsWithOnline.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      hostCache = sortedHosts;

      // Update updatedSince with the current timestamp
      updatedSinceCache = new Date().toISOString();

      // Trigger re-render
      setCacheVersion((v) => v + 1);
    }
  }, [query.data]);

  // Get current agents and hosts from cache (already sorted)
  const agents = agentCache;
  const hosts = hostCache;

  return {
    agents,
    hosts,
    isLoading: query.isLoading,
    error: query.error,
  };
};

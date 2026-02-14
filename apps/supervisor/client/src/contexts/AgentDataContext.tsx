import React, { createContext, useContext, useEffect, useState } from "react";
import { useAgentData } from "../hooks/useAgentData";
import { Agent } from "../types/agent";

export interface ClientReadStatus {
  lastReadLogId: number;
  lastReadMailId: number;
}

interface AgentDataContextType {
  agents: Agent[];
  isLoading: boolean;
  error: Error | null;
  readStatus: Record<string, ClientReadStatus>;
  updateReadStatus: (
    agentName: string,
    lastReadLogId?: number,
    lastReadMailId?: number,
  ) => Promise<void>;
}

const AgentDataContext = createContext<AgentDataContextType | undefined>(
  undefined,
);

export const AgentDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [readStatus, setReadStatus] = useState<
    Record<string, ClientReadStatus>
  >({});

  const {
    agents: cachedAgents,
    isLoading,
    error,
  } = useAgentData();

  // Update data from agent polling responses
  useEffect(() => {
    if (cachedAgents && cachedAgents.length > 0) {
      // Update agents with cached data
      setAgents(cachedAgents);

      // Update read status from agents
      setReadStatus((prevStatus) => {
        const newStatus = { ...prevStatus };

        // For each agent in the response
        cachedAgents.forEach((agent: Agent) => {
          const existingStatus = prevStatus[agent.name];

          if (!existingStatus) {
            // First load: initialize lastRead IDs to latest IDs
            newStatus[agent.name] = {
              lastReadLogId: agent.latestLogId,
              lastReadMailId: agent.latestMailId,
            };
          }
          // If already initialized, preserve local lastRead IDs
          // (they are updated separately via updateReadStatus)
        });

        return newStatus;
      });
    }
  }, [cachedAgents]);

  const updateReadStatus = async (
    agentName: string,
    lastReadLogId?: number,
    lastReadMailId?: number,
  ): Promise<void> => {
    setReadStatus((prevStatus) => {
      const currentStatus = prevStatus[agentName] || {
        lastReadLogId: 0,
        lastReadMailId: 0,
      };

      const newLogId =
        lastReadLogId !== undefined &&
        lastReadLogId > currentStatus.lastReadLogId
          ? lastReadLogId
          : currentStatus.lastReadLogId;
      const newMailId =
        lastReadMailId !== undefined &&
        lastReadMailId > currentStatus.lastReadMailId
          ? lastReadMailId
          : currentStatus.lastReadMailId;

      // Only update state if something actually changed
      if (
        newLogId === currentStatus.lastReadLogId &&
        newMailId === currentStatus.lastReadMailId
      ) {
        return prevStatus;
      }

      return {
        ...prevStatus,
        [agentName]: {
          lastReadLogId: newLogId,
          lastReadMailId: newMailId,
        },
      };
    });
  };

  const value: AgentDataContextType = {
    agents,
    isLoading,
    error,
    readStatus,
    updateReadStatus,
  };

  return (
    <AgentDataContext.Provider value={value}>
      {children}
    </AgentDataContext.Provider>
  );
};

export const useAgentDataContext = (): AgentDataContextType => {
  const context = useContext(AgentDataContext);
  if (context === undefined) {
    throw new Error(
      "useAgentDataContext must be used within an AgentDataProvider",
    );
  }
  return context;
};

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAgentData } from "../hooks/useAgentData";
import { Agent } from "../lib/apiClient";

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
  const [readStatus, setReadStatus] = useState<Record<string, ClientReadStatus>>(
    {},
  );

  const { data: agentResponse, isLoading, error } = useAgentData();

  // Update data from agent polling responses
  useEffect(() => {
    if (agentResponse?.success && agentResponse.data) {
      const responseData = agentResponse.data;

      // Update agents (not cached)
      if (responseData.agents) {
        setAgents(responseData.agents);

        // Update read status from agents
        setReadStatus((prevStatus) => {
          const newStatus = { ...prevStatus };

          // For each agent in the response
          responseData.agents.forEach((agent) => {
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
    }
  }, [agentResponse]);

  const updateReadStatus = async (
    agentName: string,
    lastReadLogId?: number,
    lastReadMailId?: number,
  ): Promise<void> => {
    setReadStatus((prevStatus) => {
      const currentStatus = prevStatus[agentName] || {
        lastReadLogId: -1,
        lastReadMailId: -1,
      };

      const newLogId =
        lastReadLogId !== undefined && lastReadLogId > currentStatus.lastReadLogId
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

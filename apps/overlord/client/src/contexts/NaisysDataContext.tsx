import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { ReadStatus } from "shared";
import { useNaisysData } from "../hooks/useNaisysData";
import { Agent } from "../lib/apiClient";

interface NaisysDataContextType {
  agents: Agent[];
  isLoading: boolean;
  error: Error | null;
  readStatus: Record<string, ReadStatus>;
  updateReadStatus: (
    agentName: string,
    lastReadLogId?: number,
    lastReadMailId?: number,
  ) => Promise<void>;
}

const NaisysDataContext = createContext<NaisysDataContextType | undefined>(
  undefined,
);

export const NaisysDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [readStatus, setReadStatus] = useState<Record<string, ReadStatus>>({});

  const { data: naisysResponse, isLoading, error } = useNaisysData();

  // Update data from NAISYS polling` responses
  useEffect(() => {
    if (naisysResponse?.success && naisysResponse.data) {
      const responseData = naisysResponse.data;

      // Update agents (not cached)
      if (responseData.agents) {
        setAgents(responseData.agents);
      }

      // Update read status (not cached)
      if (responseData.readStatus) {
        setReadStatus((prevStatus) => {
          const newStatus = { ...prevStatus };

          // For each agent in the response
          Object.entries(responseData.readStatus).forEach(
            ([agentName, serverStatus]) => {
              const existingStatus = prevStatus[agentName];

              if (!existingStatus) {
                // First load: initialize lastRead IDs to latest IDs
                newStatus[agentName] = {
                  ...serverStatus,
                  lastReadLogId: serverStatus.latestLogId,
                  lastReadMailId: serverStatus.latestMailId,
                };
              } else {
                // Already initialized: preserve local lastRead IDs, update latest IDs
                newStatus[agentName] = {
                  ...serverStatus,
                  lastReadLogId: existingStatus.lastReadLogId,
                  lastReadMailId: existingStatus.lastReadMailId,
                };
              }
            },
          );

          return newStatus;
        });
      }
    }
  }, [naisysResponse]);

  const updateReadStatus = async (
    agentName: string,
    lastReadLogId?: number,
    lastReadMailId?: number,
  ): Promise<void> => {
    setReadStatus((prevStatus) => {
      const currentStatus = prevStatus[agentName] || {
        lastReadLogId: -1,
        latestLogId: -1,
        lastReadMailId: -1,
        latestMailId: -1,
      };

      const newLogId =
        lastReadLogId !== undefined &&
        lastReadLogId > (currentStatus.lastReadLogId ?? -1)
          ? lastReadLogId
          : currentStatus.lastReadLogId;
      const newMailId =
        lastReadMailId !== undefined &&
        lastReadMailId > (currentStatus.lastReadMailId ?? -1)
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
          ...currentStatus,
          lastReadLogId: newLogId,
          lastReadMailId: newMailId,
        },
      };
    });
  };

  const value: NaisysDataContextType = {
    agents,
    isLoading,
    error,
    readStatus,
    updateReadStatus,
  };

  return (
    <NaisysDataContext.Provider value={value}>
      {children}
    </NaisysDataContext.Provider>
  );
};

export const useNaisysDataContext = (): NaisysDataContextType => {
  const context = useContext(NaisysDataContext);
  if (context === undefined) {
    throw new Error(
      "useNaisysDataContext must be used within a NaisysDataProvider",
    );
  }
  return context;
};

import type { HateoasAction } from "@naisys/common";
import React, { createContext, useContext, useEffect, useState } from "react";

import { useHostData } from "../hooks/useHostData";
import type { Host } from "../types/agent";

interface HostDataContextType {
  hosts: Host[];
  listActions?: HateoasAction[];
  targetVersion?: string;
  isLoading: boolean;
  error: Error | null;
}

const HostDataContext = createContext<HostDataContextType | undefined>(
  undefined,
);

export const HostDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [hosts, setHosts] = useState<Host[]>([]);

  const {
    hosts: cachedHosts,
    listActions,
    targetVersion,
    isLoading,
    error,
  } = useHostData();

  useEffect(() => {
    if (cachedHosts) {
      setHosts(cachedHosts);
    }
  }, [cachedHosts]);

  const value: HostDataContextType = {
    hosts,
    listActions,
    targetVersion,
    isLoading,
    error,
  };

  return (
    <HostDataContext.Provider value={value}>
      {children}
    </HostDataContext.Provider>
  );
};

export const useHostDataContext = (): HostDataContextType => {
  const context = useContext(HostDataContext);
  if (context === undefined) {
    throw new Error(
      "useHostDataContext must be used within a HostDataProvider",
    );
  }
  return context;
};

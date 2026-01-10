import React, { createContext, useContext, useEffect, useState } from "react";
import { checkSession } from "../lib/apiClient";

interface SessionContextType {
  isAuthenticated: boolean;
  setIsAuthenticated: (value: boolean) => void;
  isCheckingSession: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  // Check for existing session on component mount
  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const result = await checkSession();
        if (result.success) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Session check failed:", error);
      } finally {
        setIsCheckingSession(false);
      }
    };

    checkExistingSession();
  }, []);

  return (
    <SessionContext.Provider
      value={{ isAuthenticated, setIsAuthenticated, isCheckingSession }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
};

import type { AuthUser } from "@naisys-supervisor/shared";
import React, { createContext, useContext, useEffect, useState } from "react";
import { getMe, login as apiLogin, logout as apiLogout } from "../lib/apiAuth";

interface SessionContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isCheckingSession: boolean;
  hasPermission: (permission: string) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const authUser = await getMe();
        setUser(authUser);
      } catch {
        // Not authenticated
      } finally {
        setIsCheckingSession(false);
      }
    };

    checkExistingSession();
  }, []);

  const login = async (username: string, password: string) => {
    const result = await apiLogin(username, password);
    setUser(result.user);
  };

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  };

  const hasPermission = (permission: string): boolean => {
    return (
      (user?.permissions?.includes(permission) ||
        user?.permissions?.includes("supervisor_admin")) ??
      false
    );
  };

  return (
    <SessionContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        isCheckingSession,
        hasPermission,
        login,
        logout,
      }}
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

import type { AuthUser, Permission } from "@naisys/supervisor-shared";
import React, { createContext, useContext, useEffect, useState } from "react";

import { disconnectSocket, reconnectSocket } from "../hooks/useSocket";
import {
  getMe,
  logout as apiLogout,
  passkeyLogin,
  passwordLogin,
} from "../lib/apiAuth";
import { queryClient } from "../lib/queryClient";

interface SessionContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isCheckingSession: boolean;
  hasPermission: (permission: Permission) => boolean;
  loginWithPasskey: () => Promise<void>;
  loginWithPassword: (username: string, password: string) => Promise<void>;
  /** Called by the registration flow once the server has signed the user in. */
  setAuthenticatedUser: (user: AuthUser) => void;
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

    void checkExistingSession();
  }, []);

  const loginWithPasskey = async () => {
    const result = await passkeyLogin();
    setUser(result.user);
    reconnectSocket();
    void queryClient.invalidateQueries();
  };

  const loginWithPassword = async (username: string, password: string) => {
    const result = await passwordLogin({ username, password });
    setUser(result.user);
    reconnectSocket();
    void queryClient.invalidateQueries();
  };

  const setAuthenticatedUser = (next: AuthUser) => {
    setUser(next);
    reconnectSocket();
    void queryClient.invalidateQueries();
  };

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      disconnectSocket();
      setUser(null);
    }
  };

  const hasPermission = (permission: Permission): boolean => {
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
        loginWithPasskey,
        loginWithPassword,
        setAuthenticatedUser,
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

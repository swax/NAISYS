import { useQueryClient } from "@tanstack/react-query";

import { useSession } from "../../contexts/SessionContext";
import { useOnSocketReconnect } from "./useOnSocketReconnect";

/**
 * Invalidate all active react-query caches whenever the socket reconnects
 * after an outage, so each query refetches whatever it missed while the
 * socket was down. Mounted once, app-wide.
 *
 * Gated on auth so we don't open the socket before a session cookie exists —
 * the server's auth middleware would reject it and Socket.IO won't
 * automatically retry with the post-login cookie.
 */
export function useReconnectQueryRefresh() {
  const { isAuthenticated } = useSession();
  const queryClient = useQueryClient();

  useOnSocketReconnect(() => {
    void queryClient.invalidateQueries();
  }, isAuthenticated);
}

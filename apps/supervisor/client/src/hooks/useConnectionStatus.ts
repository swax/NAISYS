import { useQuery } from "@tanstack/react-query";

import { getStatus } from "../lib/apiAuth";

export type ConnectionState = "connected" | "degraded" | "disconnected";

export function useConnectionStatus() {
  const query = useQuery({
    queryKey: ["connection-status"],
    queryFn: getStatus,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  let status: ConnectionState;
  let label: string;

  if (query.error) {
    status = "disconnected";
    label = "Server unreachable";
  } else if (query.data && !query.data.hubConnected) {
    status = "degraded";
    label = "Hub disconnected";
  } else if (query.data && query.data.hubConnected) {
    status = "connected";
    label = "Connected";
  } else {
    // Initial loading state before first response
    status = "degraded";
    label = "Connecting...";
  }

  return { status, label };
}

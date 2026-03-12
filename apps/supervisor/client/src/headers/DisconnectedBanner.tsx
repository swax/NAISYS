import { Alert } from "@mantine/core";
import { IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import React from "react";

import { useSession } from "../contexts/SessionContext";
import { useConnectionStatus } from "../hooks/useConnectionStatus";

export const DisconnectedBanner: React.FC = () => {
  const { isAuthenticated } = useSession();
  const { status, label } = useConnectionStatus();

  // Don't show banner for unauthenticated users — WebSocket requires auth
  if (status === "connected" || !isAuthenticated) {
    return null;
  }

  return (
    <Alert
      variant="filled"
      color={status === "disconnected" ? "red" : "yellow"}
      icon={
        status === "disconnected" ? (
          <IconPlugConnectedX size="1.2rem" />
        ) : (
          <IconPlugConnected size="1.2rem" />
        )
      }
      mb="md"
    >
      {label}
    </Alert>
  );
};

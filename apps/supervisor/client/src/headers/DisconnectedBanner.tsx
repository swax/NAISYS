import { Alert } from "@mantine/core";
import { IconPlugConnectedX, IconPlugConnected } from "@tabler/icons-react";
import React from "react";
import { useConnectionStatus } from "../hooks/useConnectionStatus";

export const DisconnectedBanner: React.FC = () => {
  const { status, label } = useConnectionStatus();

  if (status === "connected") {
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

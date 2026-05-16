import { Alert, Text } from "@mantine/core";
import {
  IconEye,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import React from "react";

import { useSession } from "../contexts/SessionContext";
import { useConnectionStatus } from "../hooks/useConnectionStatus";

const alertStyles = {
  wrapper: { justifyContent: "center" as const, alignItems: "center" as const },
  body: { flex: "initial" as const },
};

export const DisconnectedBanner: React.FC = () => {
  const { isAuthenticated } = useSession();
  const { status, label } = useConnectionStatus();

  if (!isAuthenticated) {
    return (
      <Alert
        variant="light"
        color="violet"
        icon={<IconEye size="1rem" />}
        py={4}
        radius={0}
        styles={alertStyles}
      >
        <Text size="xs">Public read-only mode — login for live updates</Text>
      </Alert>
    );
  }

  // Polling is fully functional, just slower - the status icon's tooltip is
  // sufficient signal without taking over the top of the screen.
  if (status === "connected" || status === "polling") {
    return null;
  }

  return (
    <Alert
      variant="filled"
      color={
        status === "disconnected"
          ? "red"
          : status === "hub-disconnected"
            ? "orange"
            : "yellow"
      }
      icon={
        status === "disconnected" ? (
          <IconPlugConnectedX size="1rem" />
        ) : (
          <IconPlugConnected size="1rem" />
        )
      }
      py={4}
      styles={alertStyles}
    >
      <Text size="xs">{label}</Text>
    </Alert>
  );
};

import { Tooltip } from "@mantine/core";
import { IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import React from "react";

import { useConnectionStatus } from "../hooks/useConnectionStatus";

export const ConnectionStatus: React.FC = () => {
  const { status, label } = useConnectionStatus();

  const color =
    status === "disconnected"
      ? "var(--mantine-color-red-6)"
      : status === "degraded"
        ? "var(--mantine-color-yellow-6)"
        : "var(--mantine-color-green-6)";

  return (
    <Tooltip label={label}>
      {status === "disconnected" ? (
        <IconPlugConnectedX size="1.2rem" style={{ color }} />
      ) : (
        <IconPlugConnected size="1.2rem" style={{ color }} />
      )}
    </Tooltip>
  );
};

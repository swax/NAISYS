import { Tooltip } from "@mantine/core";
import { IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import React from "react";

interface ToolsHeaderProps {
  isLoading: boolean;
  error: Error | null;
}

export const ToolsHeader: React.FC<ToolsHeaderProps> = ({
  isLoading,
  error,
}) => {
  const label = error ? "Disconnected" : isLoading ? "Connecting" : "Connected";
  const color = error
    ? "var(--mantine-color-red-6)"
    : isLoading
      ? "var(--mantine-color-yellow-6)"
      : "var(--mantine-color-green-6)";

  return (
    <Tooltip label={label}>
      {error ? (
        <IconPlugConnectedX size="1.2rem" style={{ color }} />
      ) : (
        <IconPlugConnected size="1.2rem" style={{ color }} />
      )}
    </Tooltip>
  );
};

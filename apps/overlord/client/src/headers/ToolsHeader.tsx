import { Badge, Group, Tooltip } from "@mantine/core";
import {
  IconLock,
  IconLockOpen,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import React from "react";

interface ToolsHeaderProps {
  isLoading: boolean;
  error: Error | null;
  isAuthenticated: boolean;
  isMobile: boolean;
  onAuthClick: () => void;
}

export const ToolsHeader: React.FC<ToolsHeaderProps> = ({
  isLoading,
  error,
  isAuthenticated,
  isMobile,
  onAuthClick,
}) => {
  return (
    <Group gap="xs">
      <Tooltip
        label={
          error
            ? "Disconnected"
            : isLoading
              ? "Connecting"
              : "Connected"
        }
      >
        <Badge
          color={error ? "red" : isLoading ? "yellow" : "green"}
          variant="outline"
          size="lg"
          {...(!isMobile && {
            leftSection: error ? (
              <IconPlugConnectedX size="1rem" />
            ) : (
              <IconPlugConnected size="1rem" />
            )
          })}
        >
          {isMobile ? (
            error ? (
              <IconPlugConnectedX size="1rem" />
            ) : (
              <IconPlugConnected size="1rem" />
            )
          ) : (
            error
              ? "Disconnected"
              : isLoading
                ? "Connecting"
                : "Connected"
          )}
        </Badge>
      </Tooltip>
      <Tooltip label={isAuthenticated ? "Authenticated" : "Read Only"}>
        <Badge
          color={isAuthenticated ? "green" : "gray"}
          variant="outline"
          size="lg"
          style={{ cursor: "pointer" }}
          onClick={onAuthClick}
          {...(!isMobile && {
            leftSection: isAuthenticated ? (
              <IconLockOpen size="1rem" />
            ) : (
              <IconLock size="1rem" />
            )
          })}
        >
          {isMobile ? (
            isAuthenticated ? (
              <IconLockOpen size="1rem" />
            ) : (
              <IconLock size="1rem" />
            )
          ) : (
            isAuthenticated ? "Authenticated" : "Read Only"
          )}
        </Badge>
      </Tooltip>
    </Group>
  );
};

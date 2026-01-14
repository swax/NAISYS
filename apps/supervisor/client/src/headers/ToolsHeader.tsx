import { Badge, Group, Tooltip } from "@mantine/core";
import {
  IconLock,
  IconLockOpen,
  IconPlugConnected,
  IconPlugConnectedX,
  IconTopologyStar3,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useSession } from "../contexts/SessionContext";
import { useDisclosure } from "@mantine/hooks";
import { AccessDialog } from "../components/AccessDialog";
import { getMonitorMode } from "../lib/apiClient";
import type { MonitorMode } from "shared";

interface ToolsHeaderProps {
  isLoading: boolean;
  error: Error | null;
  isMobile: boolean;
}

export const ToolsHeader: React.FC<ToolsHeaderProps> = ({
  isLoading,
  error,
  isMobile,
}) => {
  const { isAuthenticated } = useSession();
  const [accessModalOpened, { open: openAccessModal, close: closeAccessModal }] =
    useDisclosure(false);
  const [monitorMode, setMonitorMode] = useState<MonitorMode | null>(null);

  useEffect(() => {
    getMonitorMode().then((response) => {
      if (response?.success) {
        setMonitorMode(response.monitorMode);
      }
    });
  }, []);

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
      {monitorMode === "monitor-hub" && (
        <Tooltip label="Hub Mode">
          <Badge
            color="yellow"
            variant="outline"
            size="lg"
            {...(!isMobile && {
              leftSection: <IconTopologyStar3 size="1rem" />,
            })}
          >
            {isMobile ? <IconTopologyStar3 size="1rem" /> : "Hub"}
          </Badge>
        </Tooltip>
      )}
      <Tooltip label={isAuthenticated ? "Authenticated" : "Read Only"}>
        <Badge
          color={isAuthenticated ? "cyan" : "gray"}
          variant="outline"
          size="lg"
          style={{ cursor: "pointer" }}
          onClick={openAccessModal}
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
      <AccessDialog opened={accessModalOpened} onClose={closeAccessModal} />
    </Group>
  );
};

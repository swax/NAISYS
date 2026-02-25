import { ActionIcon, Box, Group, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import React from "react";

import { SIDEBAR_WIDTH } from "../constants";

interface CollapsibleSidebarProps {
  children: React.ReactNode;
  /** Additional styles for the expanded content box */
  contentStyle?: React.CSSProperties;
  /** Mantine breakpoint at which the sidebar becomes visible (default: "sm") */
  visibleFrom?: string;
}

export const CollapsibleSidebar: React.FC<CollapsibleSidebarProps> = ({
  children,
  contentStyle,
  visibleFrom = "sm",
}) => {
  const [collapsed, { toggle }] = useDisclosure();

  return (
    <Box
      visibleFrom={visibleFrom}
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {collapsed ? (
        <Box
          style={{
            borderRight: "1px solid var(--mantine-color-dark-4)",
            paddingRight: 4,
          }}
        >
          <Tooltip label="Expand sidebar" position="right">
            <ActionIcon variant="subtle" color="gray" onClick={toggle}>
              <IconLayoutSidebarLeftExpand size="1.2rem" />
            </ActionIcon>
          </Tooltip>
        </Box>
      ) : (
        <Box
          style={{
            width: SIDEBAR_WIDTH,
            minWidth: SIDEBAR_WIDTH,
            borderRight: "1px solid var(--mantine-color-dark-4)",
            display: "flex",
            flexDirection: "column",
            ...contentStyle,
          }}
        >
          <Group justify="flex-end" p={4}>
            <Tooltip label="Collapse sidebar" position="right">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={toggle}
              >
                <IconLayoutSidebarLeftCollapse size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
          {children}
        </Box>
      )}
    </Box>
  );
};

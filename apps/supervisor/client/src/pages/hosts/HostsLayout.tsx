import { ActionIcon, Box, Drawer, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconServer } from "@tabler/icons-react";
import React from "react";
import { Outlet, useLocation } from "react-router-dom";

import { HostSidebar } from "../../headers/HostSidebar";

const SIDEBAR_WIDTH = 300;

export const HostsLayout: React.FC = () => {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const location = useLocation();

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 48px - 2 * var(--mantine-spacing-md))",
      }}
    >
      {/* Desktop sidebar */}
      <Box
        visibleFrom="sm"
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          overflowY: "auto",
          paddingRight: "var(--mantine-spacing-md)",
        }}
      >
        <HostSidebar />
      </Box>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {/* Sub-header: mobile server icon */}
        <Group mb="md" gap="xs">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={openDrawer}
            hiddenFrom="sm"
          >
            <IconServer size="1.2rem" />
          </ActionIcon>
        </Group>

        {/* Route content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Outlet />
        </div>
      </div>

      {/* Mobile drawer for host sidebar */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Hosts"
        size={SIDEBAR_WIDTH}
      >
        <HostSidebar />
      </Drawer>
    </div>
  );
};

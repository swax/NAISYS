import { ActionIcon, Box, Drawer, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconServer } from "@tabler/icons-react";
import React from "react";
import { Outlet, useLocation } from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { SIDEBAR_WIDTH } from "../../constants";
import { HostSidebar } from "../../headers/HostSidebar";

export const HostsLayout: React.FC = () => {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const location = useLocation();

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  return (
    <Box
      display="flex"
      style={{ flex: 1, minHeight: 0 }}
    >
      {/* Desktop sidebar */}
      <CollapsibleSidebar
        contentStyle={{
          overflowY: "auto",
          paddingRight: "var(--mantine-spacing-md)",
        }}
      >
        <HostSidebar />
      </CollapsibleSidebar>

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
        <Group
          gap="xs"
          pl={{ base: "md", sm: 0 }}
          style={{
            borderBottom:
              "calc(0.125rem * var(--mantine-scale)) solid var(--mantine-color-dark-4)",
          }}
        >
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
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--mantine-spacing-md)" }}>
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
    </Box>
  );
};

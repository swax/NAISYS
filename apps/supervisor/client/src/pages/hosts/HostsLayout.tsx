import { Box, Drawer, Group, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconServer } from "@tabler/icons-react";
import React from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { HEADER_ROW_HEIGHT, SIDEBAR_WIDTH } from "../../constants";
import { HostSidebar } from "../../headers/HostSidebar";

export const HostsLayout: React.FC = () => {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const location = useLocation();
  const { hostname } = useParams<{ hostname: string }>();

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  return (
    <Box display="flex" style={{ flex: 1, minHeight: 0 }}>
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
        {/* Sub-header: mobile host picker */}
        <UnstyledButton
          onClick={openDrawer}
          hiddenFrom="sm"
          h={HEADER_ROW_HEIGHT}
          pl="md"
          style={{
            flexShrink: 0,
            borderBottom:
              "calc(0.125rem * var(--mantine-scale)) solid var(--mantine-color-dark-4)",
          }}
        >
          <Group gap="xs" style={{ height: "100%" }}>
            <IconServer size="1.2rem" color="var(--mantine-color-dimmed)" />
            {hostname && (
              <Text size="sm" fw={600}>
                {hostname}
              </Text>
            )}
          </Group>
        </UnstyledButton>

        {/* Route content */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--mantine-spacing-md)",
          }}
        >
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

import { ActionIcon, Box, Drawer, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconRobot } from "@tabler/icons-react";
import React from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { AgentNavHeader } from "../../headers/AgentNavHeader";
import { AgentSidebar } from "../../headers/AgentSidebar";

const SIDEBAR_WIDTH = 300;

export const AgentsLayout: React.FC = () => {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  // Extract current agent name from URL
  // Path is /agents/controls/agentName
  const currentAgentName = React.useMemo(() => {
    const pathParts = location.pathname.split("/");
    return pathParts[3] || null;
  }, [location.pathname]);

  // Key for remounting on agent/expand change
  const expandParam = searchParams.get("expand");
  const key = `${currentAgentName || "no-agent"}-${expandParam || ""}`;

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
        <AgentSidebar />
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
        {/* Sub-header: mobile robot icon + agent nav tabs */}
        <Group mb="md" gap="xs">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={openDrawer}
            hiddenFrom="sm"
          >
            <IconRobot size="1.2rem" />
          </ActionIcon>
          <AgentNavHeader agentName={currentAgentName || undefined} />
        </Group>

        {/* Route content */}
        <div key={key} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Outlet />
        </div>
      </div>

      {/* Mobile drawer for agent sidebar */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Agents"
        size={SIDEBAR_WIDTH}
      >
        <AgentSidebar />
      </Drawer>
    </div>
  );
};

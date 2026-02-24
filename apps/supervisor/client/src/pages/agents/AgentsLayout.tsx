import { ActionIcon, Box, Drawer, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconRobot } from "@tabler/icons-react";
import React from "react";
import {
  Outlet,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { SIDEBAR_WIDTH } from "../../constants";
import { AgentNavHeader } from "../../headers/AgentNavHeader";
import { AgentSidebar } from "../../headers/AgentSidebar";

export const AgentsLayout: React.FC = () => {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { id } = useParams<{ id: string }>();

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  const agentId = id ? Number(id) : null;

  // Key for remounting on agent/expand change
  const expandParam = searchParams.get("expand");
  const key = `${agentId || "no-agent"}-${expandParam || ""}`;

  return (
    <Box
      display="flex"
      style={{ flex: 1, minHeight: 0 }}
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
        <Group mb={{ base: 0, sm: "md" }} gap="xs">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={openDrawer}
            hiddenFrom="sm"
          >
            <IconRobot size="1.2rem" />
          </ActionIcon>
          <AgentNavHeader agentId={agentId || undefined} />
        </Group>

        {/* Route content */}
        <div
          key={key}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
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
    </Box>
  );
};

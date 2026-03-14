import { Box, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import {
  Outlet,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { HEADER_ROW_HEIGHT, SIDEBAR_WIDTH } from "../../constants";
import { AgentNavHeader } from "../../headers/AgentNavHeader";
import { AgentSidebar } from "../../headers/AgentSidebar";

export const AgentsLayout: React.FC = () => {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { username } = useParams<{ username: string }>();

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  // Key for remounting on agent/expand change
  const expandParam = searchParams.get("expand");
  const key = `${username || "no-agent"}-${expandParam || ""}`;

  return (
    <Box display="flex" style={{ flex: 1, minHeight: 0 }}>
      {/* Desktop sidebar */}
      <CollapsibleSidebar
        visibleFrom="md"
        contentStyle={{
          overflowY: "auto",
          paddingRight: "var(--mantine-spacing-md)",
        }}
      >
        <AgentSidebar />
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
        {/* Agent nav header (agent name on mobile + tabs) */}
        <Box
          pl={{ base: "md", md: 0 }}
          h={HEADER_ROW_HEIGHT}
          style={{ flexShrink: 0 }}
        >
          <AgentNavHeader
            agentUsername={username}
            onAgentNameClick={openDrawer}
          />
        </Box>

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

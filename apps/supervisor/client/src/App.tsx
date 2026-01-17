import { AppShell, Burger, Group, MantineProvider, Text } from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  Link,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { ROUTER_BASENAME } from "./constants";
import {
  AgentDataProvider,
  useAgentDataContext,
} from "./contexts/AgentDataContext";
import { SessionProvider } from "./contexts/SessionContext";
import { AgentSidebar } from "./headers/AgentSidebar";
import { NavHeader } from "./headers/NavHeader";
import { ToolsHeader } from "./headers/ToolsHeader";
import { queryClient } from "./lib/queryClient";
import { Controls } from "./pages/Controls";
import { Home } from "./pages/home/Home";
import { Mail } from "./pages/mail/Mail";
import { Runs } from "./pages/runs/Runs";

const AppContent: React.FC = () => {
  const [opened, { toggle }] = useDisclosure();
  const location = useLocation();
  const { isLoading, error } = useAgentDataContext();
  const isMobile = useMediaQuery("(max-width: 768px)"); // sm breakpoint
  const [searchParams] = useSearchParams();

  const SIDEBAR_WIDTH = 300;

  // Extract current agent name from URL
  const currentAgentName = React.useMemo(() => {
    const pathParts = location.pathname.split("/");
    return pathParts[2] || null;
  }, [location.pathname]);

  // Define routes with keys to remount on agentName change which triggers refetching immediately
  // This prevents sessions looking on/offline when they really arent, as well as getting latest data immediately (sessions, logs, mail, etc)
  const expandParam = searchParams.get("expand");
  const key = `${currentAgentName || "no-agent"}-${expandParam || ""}`;

  return (
    <AppShell
      header={{ height: 48 }}
      navbar={{
        width: SIDEBAR_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <Link
              to="/"
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                cursor: "pointer",
              }}
            >
              <img
                src="/supervisor/apple-touch-icon.png"
                alt="NAISYS Supervisor"
                style={{ width: "36px", height: "36px" }}
              />
              <Text size="lg" fw={500} visibleFrom="sm">
                NAISYS Supervisor
              </Text>
            </Link>
            <NavHeader
              agentName={currentAgentName || undefined}
              sidebarWidth={SIDEBAR_WIDTH}
              sidebarCollapsed={isMobile}
            />
          </Group>
          <ToolsHeader
            isLoading={isLoading}
            error={error}
            isMobile={isMobile}
          />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md" style={{ overflowY: "auto" }}>
        <AgentSidebar />
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:agent" element={<Runs key={key} />} />
          <Route path="/mail" element={<Mail />} />
          <Route path="/mail/:agent" element={<Mail key={key} />} />
          <Route path="/mail/:agent/:messageId" element={<Mail />} />
          <Route path="/controls" element={<Controls />} />
          <Route path="/controls/:agent" element={<Controls />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider defaultColorScheme="dark">
        <Notifications />
        <SessionProvider>
          <AgentDataProvider>
            <Router basename={ROUTER_BASENAME}>
              <AppContent />
            </Router>
          </AgentDataProvider>
        </SessionProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

export default App;

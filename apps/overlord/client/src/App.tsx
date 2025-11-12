import {
  AppShell,
  Burger,
  Group,
  MantineProvider,
  Text,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
} from "react-router-dom";
import { AccessDialog } from "./components/AccessDialog";
import { AgentSidebar } from "./components/AgentSidebar";
import { NavHeader } from "./components/NavHeader";
import { ToolsHeader } from "./components/ToolsHeader";
import { ROUTER_BASENAME } from "./constants";
import {
  AgentDataProvider,
  useAgentDataContext,
} from "./contexts/AgentDataContext";
import { queryClient } from "./lib/queryClient";
import { Controls } from "./pages/Controls";
import { Home } from "./pages/Home";
import { Mail } from "./pages/Mail";
import { Runs } from "./pages/Runs";

const AppContent: React.FC = () => {
  const [opened, { toggle }] = useDisclosure();
  const [
    accessModalOpened,
    { open: openAccessModal, close: closeAccessModal },
  ] = useDisclosure(false);
  /*const [
    settingsModalOpened,
    { open: openSettingsModal, close: closeSettingsModal },
  ] = useDisclosure(false);*/
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const location = useLocation();
  const { isLoading, error } = useAgentDataContext();
  const isMobile = useMediaQuery("(max-width: 768px)"); // sm breakpoint

  const SIDEBAR_WIDTH = 300;

  // Extract current agent name from URL
  const currentAgentName = React.useMemo(() => {
    const pathParts = location.pathname.split("/");
    return pathParts[2] || null;
  }, [location.pathname]);

  // Check for existing session on component mount
  React.useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const response = await fetch("/api/session");
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            setIsAuthenticated(true);
          }
        }
      } catch (error) {
        console.error("Session check failed:", error);
      }
    };

    checkExistingSession();
  }, []);

  const handleLockIconClick = () => {
    openAccessModal();
  };

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
            <img
              src="/overlord/apple-touch-icon.png"
              alt="NAISYS Overlord"
              style={{ width: "36px", height: "36px" }}
            />
            <Text size="lg" fw={500} visibleFrom="sm">
              NAISYS Overlord
            </Text>
            <NavHeader
              agentName={currentAgentName || undefined}
              sidebarWidth={SIDEBAR_WIDTH}
              sidebarCollapsed={isMobile}
            />
          </Group>
          <ToolsHeader
            isLoading={isLoading}
            error={error}
            isAuthenticated={isAuthenticated}
            isMobile={isMobile}
            onAuthClick={handleLockIconClick}
          />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md" style={{ overflowY: "auto" }}>
        <AgentSidebar />
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Home />} />
          ``
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:agent" element={<Runs />} />
          <Route path="/mail" element={<Mail />} />
          <Route path="/mail/:agent" element={<Mail />} />
          <Route path="/mail/:agent/:messageId" element={<Mail />} />
          <Route path="/controls" element={<Controls />} />
          <Route path="/controls/:agent" element={<Controls />} />
        </Routes>
      </AppShell.Main>

      <AccessDialog
        opened={accessModalOpened}
        onClose={closeAccessModal}
        isAuthenticated={isAuthenticated}
        onAuthenticationChange={setIsAuthenticated}
      />

      {/*<SettingsDialog
        opened={settingsModalOpened}
        onClose={closeSettingsModal}
      />*/}
    </AppShell>
  );
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider defaultColorScheme="dark">
        <Notifications />
        <AgentDataProvider>
          <Router basename={ROUTER_BASENAME}>
            <AppContent />
          </Router>
        </AgentDataProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

export default App;

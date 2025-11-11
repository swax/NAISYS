import {
  ActionIcon,
  AppShell,
  Burger,
  Flex,
  Group,
  MantineProvider,
  Text,
  Tooltip,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import {
  IconDeviceGamepad2,
  IconHistory,
  IconLock,
  IconLockOpen,
  IconMail,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AccessDialog } from "./components/AccessDialog";
import { AgentSidebar } from "./components/AgentSidebar";
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
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoading, error } = useAgentDataContext();

  const isActive = (path: string) => {
    const currentSection = location.pathname.split("/")[1];
    const targetSection = path.replace("/", "");
    return currentSection === targetSection;
  };

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
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      footer={{ height: 60 }}
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
              style={{ width: "48px", height: "48px" }}
            />
            <Text size="lg" fw={500}>
              NAISYS Overlord
            </Text>
          </Group>
          <Group gap="xs">
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
                <ActionIcon
                  variant={error ? "filled" : isLoading ? "outline" : "filled"}
                  color={error ? "red" : isLoading ? "yellow" : "green"}
                  size="lg"
                >
                  {error ? (
                    <IconPlugConnectedX size="1.2rem" />
                  ) : (
                    <IconPlugConnected size="1.2rem" />
                  )}
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group
              gap="xs"
              style={{ cursor: "pointer" }}
              onClick={handleLockIconClick}
            >
              <Tooltip label={isAuthenticated ? "Authenticated" : "Read Only"}>
                <ActionIcon
                  variant={isAuthenticated ? "filled" : "subtle"}
                  color={isAuthenticated ? "green" : undefined}
                  size="lg"
                >
                  {isAuthenticated ? (
                    <IconLockOpen size="1.2rem" />
                  ) : (
                    <IconLock size="1.2rem" />
                  )}
                </ActionIcon>
              </Tooltip>
            </Group>
            {/*<Group
              gap="xs"
              style={{ cursor: "pointer" }}
              onClick={openSettingsModal}
            >
              <Tooltip label="Settings">
                <ActionIcon variant="subtle" size="lg">
                  <IconSettings size="1.2rem" />
                </ActionIcon>
              </Tooltip>
            </Group>*/}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AgentSidebar />
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Home />} />``
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:agent" element={<Runs />} />
          <Route path="/mail" element={<Mail />} />
          <Route path="/mail/:agent" element={<Mail />} />
          <Route path="/mail/:agent/:messageId" element={<Mail />} />
          <Route path="/controls" element={<Controls />} />
          <Route path="/controls/:agent" element={<Controls />} />
        </Routes>
      </AppShell.Main>

      <AppShell.Footer>
        <Flex h="100%" px="md" align="center" justify="space-evenly">
          <Group
            gap="xs"
            style={{ cursor: "pointer" }}
            onClick={() => {
              const pathParts = location.pathname.split("/");
              const currentAgent = pathParts[2];
              if (currentAgent) {
                navigate(`/runs/${currentAgent}`);
              } else {
                navigate("/runs");
              }
            }}
          >
            <ActionIcon
              variant={isActive("/runs") ? "filled" : "subtle"}
              size="lg"
              aria-label="Runs"
            >
              <IconHistory size="1.2rem" />
            </ActionIcon>
            <Text size="xs" visibleFrom="sm">
              Runs
            </Text>
          </Group>
          <Group
            gap="xs"
            style={{ cursor: "pointer" }}
            onClick={() => {
              const pathParts = location.pathname.split("/");
              const currentAgent = pathParts[2];
              if (currentAgent) {
                navigate(`/mail/${currentAgent}`);
              } else {
                navigate("/mail");
              }
            }}
          >
            <ActionIcon
              variant={isActive("/mail") ? "filled" : "subtle"}
              size="lg"
              aria-label="Mail"
            >
              <IconMail size="1.2rem" />
            </ActionIcon>
            <Text size="xs" visibleFrom="sm">
              Mail
            </Text>
          </Group>
          <Group
            gap="xs"
            style={{ cursor: "pointer" }}
            onClick={() => {
              const pathParts = location.pathname.split("/");
              const currentAgent = pathParts[2];
              if (currentAgent) {
                navigate(`/controls/${currentAgent}`);
              } else {
                navigate("/controls");
              }
            }}
          >
            <ActionIcon
              variant={isActive("/controls") ? "filled" : "subtle"}
              size="lg"
              aria-label="Controls"
            >
              <IconDeviceGamepad2 size="1.2rem" />
            </ActionIcon>
            <Text size="xs" visibleFrom="sm">
              Controls
            </Text>
          </Group>
        </Flex>
      </AppShell.Footer>

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
          <Router basename="/overlord">
            <AppContent />
          </Router>
        </AgentDataProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

export default App;

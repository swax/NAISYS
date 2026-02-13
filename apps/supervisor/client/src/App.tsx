import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  MantineProvider,
  Text,
  Tooltip,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { IconApi } from "@tabler/icons-react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  BrowserRouter as Router,
  Link,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { ROUTER_BASENAME } from "./constants";
import {
  AgentDataProvider,
  useAgentDataContext,
} from "./contexts/AgentDataContext";
import { LoginDialog } from "./components/LoginDialog";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { AgentNavHeader } from "./headers/AgentNavHeader";
import { AgentSidebar } from "./headers/AgentSidebar";
import { ToolsHeader } from "./headers/ToolsHeader";
import naisysLogo from "@naisys/common/assets/naisys-logo.webp";
import { queryClient } from "./lib/queryClient";
import { Controls } from "./pages/Controls";
import { Home } from "./pages/home/Home";
import { HostPage } from "./pages/HostPage";
import { Mail } from "./pages/mail/Mail";
import { Runs } from "./pages/runs/Runs";
import { UserList } from "./pages/users/UserList";
import { UserDetail } from "./pages/users/UserDetail";

const AppContent: React.FC = () => {
  const [opened, { toggle }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const location = useLocation();
  const { isLoading, error } = useAgentDataContext();
  const { user, isAuthenticated, hasPermission, logout } = useSession();
  const isMobile = useMediaQuery("(max-width: 768px)"); // sm breakpoint
  const [searchParams] = useSearchParams();
  const [plugins, setPlugins] = React.useState<string[]>([]);

  const SIDEBAR_WIDTH = 300;

  // Fetch enabled plugins on mount
  React.useEffect(() => {
    fetch("/api/supervisor/plugins")
      .then((r) => r.json())
      .then((d) => setPlugins(d.plugins))
      .catch(() => {});
  }, []);

  const hasErp = plugins.includes("erp");
  const isUsersPage = location.pathname.startsWith("/users");
  const showUsersTab = hasPermission("supervisor_admin");

  // Extract current agent name from URL
  const currentAgentName = React.useMemo(() => {
    const pathParts = location.pathname.split("/");
    // Don't return agent name if on host page or users page
    if (pathParts[1] === "host" || pathParts[1] === "users") {
      return null;
    }
    return pathParts[2] || null;
  }, [location.pathname]);

  // Check if on host page (hide agent nav header)
  const isHostPage = location.pathname.startsWith("/host/");

  // Define routes with keys to remount on agentName change which triggers refetching immediately
  // This prevents sessions looking on/offline when they really arent, as well as getting latest data immediately (sessions, logs, mail, etc)
  const expandParam = searchParams.get("expand");
  const key = `${currentAgentName || "no-agent"}-${expandParam || ""}`;

  return (
    <AppShell
      header={{ height: 48 }}
      navbar={
        isUsersPage
          ? undefined
          : {
              width: SIDEBAR_WIDTH,
              breakpoint: "sm",
              collapsed: { mobile: !opened },
            }
      }
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            {!isUsersPage && (
              <Burger
                opened={opened}
                onClick={toggle}
                hiddenFrom="sm"
                size="sm"
              />
            )}
            <Link
              to="/"
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
            >
              <img
                src={naisysLogo}
                alt="NAISYS"
                style={{ width: "36px", height: "36px" }}
              />
              <Text size="lg" fw={500} visibleFrom="sm">
                NAISYS
              </Text>
            </Link>
            <Group gap={6} visibleFrom="sm">
              <Link
                to="/"
                style={{ textDecoration: "none" }}
              >
                <Text
                  size="sm"
                  fw={!isUsersPage ? 700 : undefined}
                  c={isUsersPage ? "dimmed" : undefined}
                  style={{ cursor: "pointer" }}
                >
                  Supervisor
                </Text>
              </Link>
              {showUsersTab && (
                <>
                  <Text size="sm" c="dimmed">
                    |
                  </Text>
                  <Link
                    to="/users"
                    style={{ textDecoration: "none" }}
                  >
                    <Text
                      size="sm"
                      fw={isUsersPage ? 700 : undefined}
                      c={!isUsersPage ? "dimmed" : undefined}
                      style={{ cursor: "pointer" }}
                    >
                      Users
                    </Text>
                  </Link>
                </>
              )}
              {hasErp && (
                <>
                  <Text size="sm" c="dimmed">
                    |
                  </Text>
                  <Text
                    size="sm"
                    c="dimmed"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      window.location.href = "/erp/";
                    }}
                  >
                    ERP
                  </Text>
                </>
              )}
            </Group>
            {!isHostPage && !isUsersPage && (
              <AgentNavHeader
                agentName={currentAgentName || undefined}
                sidebarWidth={SIDEBAR_WIDTH}
                sidebarCollapsed={isMobile}
              />
            )}
          </Group>
          <Group gap="xs">
            <Tooltip label="API Reference">
              <ActionIcon
                variant="subtle"
                color="gray"
                component="a"
                href="/supervisor/api-reference/"
              >
                <IconApi size="1.2rem" />
              </ActionIcon>
            </Tooltip>
            <ToolsHeader isLoading={isLoading} error={error} />
            {isAuthenticated ? (
              <>
                <Text size="sm">{user?.username}</Text>
                <Button size="xs" variant="subtle" onClick={() => logout()}>
                  Logout
                </Button>
              </>
            ) : (
              <Button size="xs" variant="subtle" onClick={openLogin}>
                Login
              </Button>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      {!isUsersPage && (
        <AppShell.Navbar p="md" style={{ overflowY: "auto" }}>
          {hasErp && (
            <Text
              size="sm"
              c="dimmed"
              mb="md"
              style={{ cursor: "pointer" }}
              onClick={() => {
                window.location.href = "/erp/";
              }}
            >
              ERP
            </Text>
          )}
          <AgentSidebar />
        </AppShell.Navbar>
      )}

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
          <Route path="/host/:hostName" element={<HostPage />} />
          <Route path="/users" element={<UserList />} />
          <Route path="/users/:id" element={<UserDetail />} />
        </Routes>
      </AppShell.Main>
      <LoginDialog opened={loginOpen} onClose={closeLogin} />
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

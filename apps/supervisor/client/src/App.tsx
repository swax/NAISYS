import { AppShell, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
} from "react-router-dom";
import { ROUTER_BASENAME } from "./constants";
import { AgentDataProvider } from "./contexts/AgentDataContext";
import { HostDataProvider } from "./contexts/HostDataContext";
import { LoginDialog } from "./components/LoginDialog";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { LoginPage } from "./pages/LoginPage";
import { AppHeader } from "./headers/AppHeader";
import { AppNavbar } from "./headers/AppNavbar";
import { DisconnectedBanner } from "./headers/DisconnectedBanner";
import { queryClient } from "./lib/queryClient";
import { AgentConfig } from "./pages/agents/AgentConfig";
import { AgentDetail } from "./pages/agents/AgentDetail";
import { AgentIndex } from "./pages/agents/AgentIndex";
import { HostPage } from "./pages/hosts/HostPage";
import { HostIndex } from "./pages/hosts/HostIndex";
import { HostsLayout } from "./pages/hosts/HostsLayout";
import { Mail } from "./pages/mail/Mail";
import { Runs } from "./pages/runs/Runs";
import { UserList } from "./pages/users/UserList";
import { UserDetail } from "./pages/users/UserDetail";
import { AgentsLayout } from "./pages/agents/AgentsLayout";
import { ModelsLayout } from "./pages/models/ModelsLayout";
import { ModelIndex } from "./pages/models/ModelIndex";
import { ModelPage } from "./pages/models/ModelPage";
import { AdminPage } from "./pages/admin/AdminPage";
import { VariablesPage } from "./pages/variables/VariablesPage";

const AppContent: React.FC = () => {
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const [plugins, setPlugins] = React.useState<string[]>([]);
  const [publicRead, setPublicRead] = React.useState(false);
  const [clientConfigLoaded, setClientConfigLoaded] = React.useState(false);
  const { isAuthenticated, isCheckingSession } = useSession();

  // Fetch client config (plugins, publicRead) on mount
  React.useEffect(() => {
    fetch("/api/supervisor/client-config")
      .then((r) => r.json())
      .then((d) => {
        setPlugins(d.plugins);
        setPublicRead(d.publicRead);
      })
      .catch(() => {})
      .finally(() => setClientConfigLoaded(true));
  }, []);

  const hasErp = plugins.includes("erp");

  // Wait for both session check and client config to complete
  if (isCheckingSession || !clientConfigLoaded) {
    return null;
  }

  // Show full-page login when not authenticated and public read is disabled
  if (!isAuthenticated && !publicRead) {
    return <LoginPage />;
  }

  return (
    <AppShell
      header={{ height: 48 }}
      navbar={{
        width: 300,
        breakpoint: "sm",
        collapsed: { desktop: true, mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader
          burgerOpened={opened}
          onBurgerClick={toggle}
          onLoginOpen={openLogin}
          hasErp={hasErp}
        />
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AppNavbar onClose={close} hasErp={hasErp} />
      </AppShell.Navbar>

      <AppShell.Main>
        <DisconnectedBanner />
        <Outlet />
      </AppShell.Main>
      <LoginDialog opened={loginOpen} onClose={closeLogin} />
    </AppShell>
  );
};

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppContent />}>
      <Route path="/agents" element={<AgentsLayout />}>
        <Route index element={<AgentIndex />} />
        <Route path=":id" element={<AgentDetail />} />
        <Route path=":id/config" element={<AgentConfig />} />
        <Route path=":id/runs" element={<Runs />} />
        <Route path=":id/mail" element={<Mail />} />
        <Route path=":id/mail/:messageId" element={<Mail />} />
      </Route>
      <Route path="/hosts" element={<HostsLayout />}>
        <Route index element={<HostIndex />} />
        <Route path=":id" element={<HostPage />} />
      </Route>
      <Route path="/models" element={<ModelsLayout />}>
        <Route index element={<ModelIndex />} />
        <Route path=":key" element={<ModelPage />} />
      </Route>
      <Route path="/variables" element={<VariablesPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/users" element={<UserList />} />
      <Route path="/users/:id" element={<UserDetail />} />
      <Route path="/" element={<Navigate to="/agents" replace />} />
    </Route>,
  ),
  { basename: ROUTER_BASENAME },
);

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider defaultColorScheme="dark">
        <Notifications />
        <SessionProvider>
          <AgentDataProvider>
            <HostDataProvider>
              <RouterProvider router={router} />
            </HostDataProvider>
          </AgentDataProvider>
        </SessionProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

export default App;

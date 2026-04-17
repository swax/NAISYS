import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { AppShell, Box, MantineProvider } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import type { Permission } from "@naisys/supervisor-shared";
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

import { LoginDialog } from "./components/LoginDialog";
import { NotFoundPage } from "./components/NotFoundPage";
import { RootErrorPage } from "./components/RootErrorPage";
import { RouteErrorPage } from "./components/RouteErrorPage";
import { NAV_HEADER_ROW_HEIGHT, ROUTER_BASENAME } from "./constants";
import { AgentDataProvider } from "./contexts/AgentDataContext";
import { HostDataProvider } from "./contexts/HostDataContext";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { AppHeader } from "./headers/AppHeader";
import { AppNavbar } from "./headers/AppNavbar";
import { DisconnectedBanner } from "./headers/DisconnectedBanner";
import { queryClient } from "./lib/queryClient";
import { useBoomGuard } from "./lib/useBoomGuard";
import { AdminPage } from "./pages/admin/AdminPage";
import { AgentConfig } from "./pages/agents/AgentConfig";
import { AgentDetail } from "./pages/agents/AgentDetail";
import { AgentIndex } from "./pages/agents/AgentIndex";
import { AgentsLayout } from "./pages/agents/AgentsLayout";
import { AgentChat } from "./pages/chat/AgentChat";
import { CostsPage } from "./pages/costs/CostsPage";
import { HostIndex } from "./pages/hosts/HostIndex";
import { HostPage } from "./pages/hosts/HostPage";
import { HostsLayout } from "./pages/hosts/HostsLayout";
import { LoginPage } from "./pages/LoginPage";
import { AgentMail } from "./pages/mail/AgentMail";
import { ModelCalculator } from "./pages/models/ModelCalculator";
import { ModelIndex } from "./pages/models/ModelIndex";
import { ModelPage } from "./pages/models/ModelPage";
import { ModelsLayout } from "./pages/models/ModelsLayout";
import { AgentRuns } from "./pages/runs/AgentRuns";
import { UserDetail } from "./pages/users/UserDetail";
import { UserList } from "./pages/users/UserList";
import { VariablesPage } from "./pages/variables/VariablesPage";

export interface AppOutletContext {
  permissions: Permission[];
}

const AppContent: React.FC = () => {
  useBoomGuard("root");
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const [plugins, setPlugins] = React.useState<string[]>([]);
  const [publicRead, setPublicRead] = React.useState(false);
  const [permissions, setPermissions] = React.useState<Permission[]>([]);
  const [clientConfigLoaded, setClientConfigLoaded] = React.useState(false);
  const { isAuthenticated, isCheckingSession } = useSession();

  // Fetch client config (plugins, publicRead, permissions) on mount
  React.useEffect(() => {
    fetch("/supervisor/api/client-config")
      .then((r) => r.json())
      .then((d) => {
        setPlugins(d.plugins);
        setPublicRead(d.publicRead);
        setPermissions(d.permissions);
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
    <AgentDataProvider>
      <HostDataProvider>
        <AppShell
          header={{ height: NAV_HEADER_ROW_HEIGHT }}
          navbar={{
            width: 300,
            breakpoint: "sm",
            collapsed: { desktop: true, mobile: !opened },
          }}
          padding={0}
        >
          <AppShell.Header>
            <AppHeader
              onBurgerClick={toggle}
              onLoginOpen={openLogin}
              hasErp={hasErp}
            />
          </AppShell.Header>

          <AppShell.Navbar p="md">
            <AppNavbar onClose={close} hasErp={hasErp} />
          </AppShell.Navbar>

          <AppShell.Main
            style={{
              height: "100dvh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <DisconnectedBanner />
            <Box
              px={{ base: 0, sm: "xs" }}
              pt={0}
              pb={0}
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "auto",
              }}
            >
              <Outlet context={{ permissions }} />
            </Box>
          </AppShell.Main>
          <LoginDialog opened={loginOpen} onClose={closeLogin} />
        </AppShell>
      </HostDataProvider>
    </AgentDataProvider>
  );
};

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppContent />} errorElement={<RootErrorPage />}>
      <Route path="/agents" element={<AgentsLayout />}>
        <Route index element={<AgentIndex />} errorElement={<RouteErrorPage />} />
        <Route path=":username" element={<AgentDetail />} errorElement={<RouteErrorPage />} />
        <Route path=":username/config" element={<AgentConfig />} errorElement={<RouteErrorPage />} />
        <Route path=":username/runs" element={<AgentRuns />} errorElement={<RouteErrorPage />} />
        <Route path=":username/runs/:runKey" element={<AgentRuns />} errorElement={<RouteErrorPage />} />
        <Route path=":username/mail" element={<AgentMail />} errorElement={<RouteErrorPage />} />
        <Route path=":username/mail/with/*" element={<AgentMail />} errorElement={<RouteErrorPage />} />
        <Route path=":username/mail/about/*" element={<AgentMail />} errorElement={<RouteErrorPage />} />
        <Route path=":username/chat" element={<AgentChat />} errorElement={<RouteErrorPage />} />
        <Route path=":username/chat/:participants" element={<AgentChat />} errorElement={<RouteErrorPage />} />
        <Route path=":username/*" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/hosts" element={<HostsLayout />}>
        <Route index element={<HostIndex />} errorElement={<RouteErrorPage />} />
        <Route path=":hostname" element={<HostPage />} errorElement={<RouteErrorPage />} />
      </Route>
      <Route path="/models" element={<ModelsLayout />}>
        <Route index element={<ModelIndex />} errorElement={<RouteErrorPage />} />
        <Route path="calculator" element={<ModelCalculator />} errorElement={<RouteErrorPage />} />
        <Route path=":key" element={<ModelPage />} errorElement={<RouteErrorPage />} />
      </Route>
      <Route path="/costs" element={<CostsPage />} errorElement={<RouteErrorPage />} />
      <Route path="/variables" element={<VariablesPage />} errorElement={<RouteErrorPage />} />
      <Route path="/admin" element={<AdminPage />} errorElement={<RouteErrorPage />} />
      <Route path="/users" element={<UserList />} errorElement={<RouteErrorPage />} />
      <Route path="/users/:username" element={<UserDetail />} errorElement={<RouteErrorPage />} />
      <Route path="/" element={<Navigate to="/agents" replace />} />
      <Route path="*" element={<NotFoundPage />} />
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
          <RouterProvider router={router} />
        </SessionProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

export default App;

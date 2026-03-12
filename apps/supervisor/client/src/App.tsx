import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { AppShell, Box, MantineProvider } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import type { Permission } from "@naisys-supervisor/shared";
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
import { ROUTER_BASENAME } from "./constants";
import { AgentDataProvider } from "./contexts/AgentDataContext";
import { HostDataProvider } from "./contexts/HostDataContext";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { AppHeader } from "./headers/AppHeader";
import { AppNavbar } from "./headers/AppNavbar";
import { DisconnectedBanner } from "./headers/DisconnectedBanner";
import { queryClient } from "./lib/queryClient";
import { AdminPage } from "./pages/admin/AdminPage";
import { AgentConfig } from "./pages/agents/AgentConfig";
import { AgentDetail } from "./pages/agents/AgentDetail";
import { AgentIndex } from "./pages/agents/AgentIndex";
import { AgentsLayout } from "./pages/agents/AgentsLayout";
import { AgentChat } from "./pages/chat/AgentChat";
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
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const [plugins, setPlugins] = React.useState<string[]>([]);
  const [publicRead, setPublicRead] = React.useState(false);
  const [permissions, setPermissions] = React.useState<Permission[]>([]);
  const [clientConfigLoaded, setClientConfigLoaded] = React.useState(false);
  const { isAuthenticated, isCheckingSession } = useSession();

  // Fetch client config (plugins, publicRead, permissions) on mount
  React.useEffect(() => {
    fetch("/api/supervisor/client-config")
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
    <AppShell
      header={{ height: 48 }}
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
          <DisconnectedBanner />
          <Outlet context={{ permissions }} />
        </Box>
      </AppShell.Main>
      <LoginDialog opened={loginOpen} onClose={closeLogin} />
    </AppShell>
  );
};

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppContent />} errorElement={<RootErrorPage />}>
      <Route path="/agents" element={<AgentsLayout />}>
        <Route index element={<AgentIndex />} />
        <Route path=":username" element={<AgentDetail />} />
        <Route path=":username/config" element={<AgentConfig />} />
        <Route path=":username/runs" element={<AgentRuns />} />
        <Route path=":username/runs/:runKey" element={<AgentRuns />} />
        <Route path=":username/mail" element={<AgentMail />} />
        <Route path=":username/mail/with/*" element={<AgentMail />} />
        <Route path=":username/mail/about/*" element={<AgentMail />} />
        <Route path=":username/chat" element={<AgentChat />} />
        <Route path=":username/chat/:participants" element={<AgentChat />} />
        <Route path=":username/*" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/hosts" element={<HostsLayout />}>
        <Route index element={<HostIndex />} />
        <Route path=":hostname" element={<HostPage />} />
      </Route>
      <Route path="/models" element={<ModelsLayout />}>
        <Route index element={<ModelIndex />} />
        <Route path="calculator" element={<ModelCalculator />} />
        <Route path=":key" element={<ModelPage />} />
      </Route>
      <Route path="/variables" element={<VariablesPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/users" element={<UserList />} />
      <Route path="/users/:username" element={<UserDetail />} />
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

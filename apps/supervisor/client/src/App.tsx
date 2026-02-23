import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { AppShell, MantineProvider } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
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
import { ModelIndex } from "./pages/models/ModelIndex";
import { ModelPage } from "./pages/models/ModelPage";
import { ModelsLayout } from "./pages/models/ModelsLayout";
import { AgentRuns } from "./pages/runs/AgentRuns";
import { UserDetail } from "./pages/users/UserDetail";
import { UserList } from "./pages/users/UserList";
import { VariablesPage } from "./pages/variables/VariablesPage";

export interface AppOutletContext {
  permissions: string[];
}

const AppContent: React.FC = () => {
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const [plugins, setPlugins] = React.useState<string[]>([]);
  const [publicRead, setPublicRead] = React.useState(false);
  const [permissions, setPermissions] = React.useState<string[]>([]);
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
        <Outlet context={{ permissions }} />
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
        <Route path=":id" element={<AgentDetail />} />
        <Route path=":id/config" element={<AgentConfig />} />
        <Route path=":id/runs" element={<AgentRuns />} />
        <Route path=":id/mail" element={<AgentMail />} />
        <Route path=":id/mail/:messageId" element={<AgentMail />} />
        <Route path=":id/chat" element={<AgentChat />} />
        <Route path=":id/*" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
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

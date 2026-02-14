import { AppShell, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { ROUTER_BASENAME } from "./constants";
import { AgentDataProvider } from "./contexts/AgentDataContext";
import { HostDataProvider } from "./contexts/HostDataContext";
import { LoginDialog } from "./components/LoginDialog";
import { SessionProvider } from "./contexts/SessionContext";
import { AppHeader } from "./headers/AppHeader";
import { AppNavbar } from "./headers/AppNavbar";
import { queryClient } from "./lib/queryClient";
import { Controls } from "./pages/Controls";
import { AgentIndex } from "./pages/agents/AgentIndex";
import { HostPage } from "./pages/HostPage";
import { HostIndex } from "./pages/hosts/HostIndex";
import { HostsLayout } from "./pages/hosts/HostsLayout";
import { Mail } from "./pages/mail/Mail";
import { Runs } from "./pages/runs/Runs";
import { UserList } from "./pages/users/UserList";
import { UserDetail } from "./pages/users/UserDetail";
import { AgentsLayout } from "./pages/agents/AgentsLayout";

const AppContent: React.FC = () => {
  const [opened, { toggle, close }] = useDisclosure();
  const [loginOpen, { open: openLogin, close: closeLogin }] = useDisclosure();
  const [plugins, setPlugins] = React.useState<string[]>([]);

  // Fetch enabled plugins on mount
  React.useEffect(() => {
    fetch("/api/supervisor/plugins")
      .then((r) => r.json())
      .then((d) => setPlugins(d.plugins))
      .catch(() => {});
  }, []);

  const hasErp = plugins.includes("erp");

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
        <Routes>
          <Route path="/agents" element={<AgentsLayout />}>
            <Route index element={<AgentIndex />} />
            <Route path="runs" element={<Runs />} />
            <Route path="runs/:agent" element={<Runs />} />
            <Route path="mail" element={<Mail />} />
            <Route path="mail/:agent" element={<Mail />} />
            <Route path="mail/:agent/:messageId" element={<Mail />} />
            <Route path="controls" element={<Controls />} />
            <Route path="controls/:agent" element={<Controls />} />
          </Route>
          <Route path="/hosts" element={<HostsLayout />}>
            <Route index element={<HostIndex />} />
            <Route path=":hostName" element={<HostPage />} />
          </Route>
          <Route path="/users" element={<UserList />} />
          <Route path="/users/:id" element={<UserDetail />} />
          <Route path="/" element={<Navigate to="/agents" replace />} />
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
            <HostDataProvider>
              <Router basename={ROUTER_BASENAME}>
                <AppContent />
              </Router>
            </HostDataProvider>
          </AgentDataProvider>
        </SessionProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

export default App;

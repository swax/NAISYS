import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./animations.css";

import {
  AppShell,
  Box,
  MantineProvider,
  v8CssVariablesResolver,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import type { Permission } from "@naisys/supervisor-shared";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import React from "react";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
} from "react-router-dom";

import { NotFoundPage } from "./components/error/NotFoundPage";
import { RootErrorPage } from "./components/error/RootErrorPage";
import { RouteErrorPage } from "./components/error/RouteErrorPage";
import { FloatingVoiceControl } from "./components/feature/FloatingVoiceControl";
import { StepUpPasswordPromptProvider } from "./components/StepUpPasswordPrompt";
import { NAV_HEADER_ROW_HEIGHT, ROUTER_BASENAME } from "./constants";
import { AgentDataProvider } from "./contexts/AgentDataContext";
import { HostDataProvider } from "./contexts/HostDataContext";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { VoiceSessionProvider } from "./contexts/VoiceSessionContext";
import { useReconnectQueryRefresh } from "./hooks/socket/useReconnectQueryRefresh";
import { useChartThemeSync } from "./lib/charts";
import { queryClient } from "./lib/queryClient";
import { useBoomGuard } from "./lib/useBoomGuard";
import { AppHeader } from "./nav/AppHeader";
import { AppNavbar } from "./nav/AppNavbar";
import { DisconnectedBanner } from "./nav/DisconnectedBanner";
import { AdminPage } from "./pages/admin/AdminPage";
import { AgentDetail } from "./pages/agents/AgentDetail";
import { AgentIndex } from "./pages/agents/AgentIndex";
import { AgentsLayout } from "./pages/agents/AgentsLayout";
import { AgentConfig } from "./pages/agents/config/AgentConfig";
import { AgentChat } from "./pages/chat/AgentChat";
import { CostsPage } from "./pages/costs/CostsPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { HostIndex } from "./pages/hosts/HostIndex";
import { HostPage } from "./pages/hosts/HostPage";
import { HostsLayout } from "./pages/hosts/HostsLayout";
import { LoginPage } from "./pages/LoginPage";
import { AgentMail } from "./pages/mail/AgentMail";
import { ModelCalculator } from "./pages/models/ModelCalculator";
import { ModelIndex } from "./pages/models/ModelIndex";
import { ModelPage } from "./pages/models/ModelPage";
import { ModelsLayout } from "./pages/models/ModelsLayout";
import { RegisterPage } from "./pages/RegisterPage";
import { AgentRuns } from "./pages/runs/AgentRuns";
import { UserDetail } from "./pages/users/UserDetail";
import { UserList } from "./pages/users/UserList";
import { VariablesPage } from "./pages/variables/VariablesPage";

export interface VoiceAvailability {
  available: boolean;
  reason?: string;
}

export interface AppOutletContext {
  permissions: Permission[];
  allowPasswordLogin: boolean;
  mailServiceEnabled: boolean;
  voice: VoiceAvailability;
}

/** `/client-config` payload: route context plus the app-gating flags. */
interface ClientConfig extends AppOutletContext {
  plugins: string[];
  publicRead: boolean;
}

// Used until /client-config resolves, and as the fallback if it fails — a
// config outage must never silently unlock the app.
const FAIL_CLOSED_CONFIG: ClientConfig = {
  plugins: [],
  publicRead: false,
  allowPasswordLogin: false,
  permissions: [],
  mailServiceEnabled: false,
  voice: { available: false },
};

const AppContent: React.FC = () => {
  useBoomGuard("root");
  useReconnectQueryRefresh();
  const [opened, { toggle, close }] = useDisclosure();
  const { isAuthenticated, isCheckingSession } = useSession();

  // Client config gates rendering (public read, login mode) and feeds route
  // context. A failed fetch leaves the query without data, and the app falls
  // back to FAIL_CLOSED_CONFIG below.
  const clientConfigQuery = useQuery({
    queryKey: ["client-config"],
    queryFn: async (): Promise<ClientConfig> => {
      const response = await fetch("/supervisor/api/client-config");
      if (!response.ok) {
        throw new Error(`client-config: ${response.status}`);
      }
      const d = await response.json();
      return {
        plugins: d.plugins ?? [],
        publicRead: d.publicRead === true,
        allowPasswordLogin: d.allowPasswordLogin === true,
        permissions: d.permissions ?? [],
        mailServiceEnabled: d.mailServiceEnabled === true,
        voice:
          d.voice && typeof d.voice.available === "boolean"
            ? { available: d.voice.available, reason: d.voice.reason }
            : { available: false },
      };
    },
  });

  const {
    plugins,
    publicRead,
    allowPasswordLogin,
    permissions,
    mailServiceEnabled,
    voice,
  } = clientConfigQuery.data ?? FAIL_CLOSED_CONFIG;
  const hasErp = plugins.includes("erp");

  // Wait for both the session check and the client-config fetch to settle.
  if (isCheckingSession || clientConfigQuery.isLoading) {
    return null;
  }

  // Allow the passkey registration page to render without an authenticated
  // session — operators arrive there from a one-time invite link.
  const path = window.location.pathname;
  const basenameStripped = path.startsWith(ROUTER_BASENAME)
    ? path.slice(ROUTER_BASENAME.length)
    : path;
  if (basenameStripped.startsWith("/register")) {
    return (
      <Outlet
        context={{
          permissions: [],
          allowPasswordLogin,
          mailServiceEnabled,
          voice,
        }}
      />
    );
  }

  // Show full-page login when not authenticated and public read is disabled
  if (!isAuthenticated && !publicRead) {
    return <LoginPage allowPasswordLogin={allowPasswordLogin} />;
  }

  return (
    <AgentDataProvider>
      <HostDataProvider>
        <VoiceSessionProvider>
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
              <AppHeader onBurgerClick={toggle} hasErp={hasErp} />
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
                <Outlet
                  context={{
                    permissions,
                    allowPasswordLogin,
                    mailServiceEnabled,
                    voice,
                  }}
                />
              </Box>
            </AppShell.Main>
          </AppShell>
          <FloatingVoiceControl />
        </VoiceSessionProvider>
      </HostDataProvider>
    </AgentDataProvider>
  );
};

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppContent />} errorElement={<RootErrorPage />}>
      <Route path="/agents" element={<AgentsLayout />}>
        <Route
          index
          element={<AgentIndex />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username"
          element={<AgentDetail />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/config"
          element={<AgentConfig />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/runs"
          element={<AgentRuns />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/runs/:runId/sessions/:sessionId"
          element={<AgentRuns />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/runs/:runId/subagents/:subagentId/sessions/:sessionId"
          element={<AgentRuns />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/mail"
          element={<AgentMail />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/mail/with/*"
          element={<AgentMail />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/mail/about/*"
          element={<AgentMail />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/chat"
          element={<AgentChat />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":username/chat/:participants"
          element={<AgentChat />}
          errorElement={<RouteErrorPage />}
        />
        <Route path=":username/*" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/hosts" element={<HostsLayout />}>
        <Route
          index
          element={<HostIndex />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":hostname"
          element={<HostPage />}
          errorElement={<RouteErrorPage />}
        />
      </Route>
      <Route path="/models" element={<ModelsLayout />}>
        <Route
          index
          element={<ModelIndex />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path="calculator"
          element={<ModelCalculator />}
          errorElement={<RouteErrorPage />}
        />
        <Route
          path=":key"
          element={<ModelPage />}
          errorElement={<RouteErrorPage />}
        />
      </Route>
      <Route
        path="/dashboard"
        element={<DashboardPage />}
        errorElement={<RouteErrorPage />}
      />
      <Route
        path="/costs"
        element={<CostsPage />}
        errorElement={<RouteErrorPage />}
      />
      <Route
        path="/variables"
        element={<VariablesPage />}
        errorElement={<RouteErrorPage />}
      />
      <Route
        path="/admin"
        element={<AdminPage />}
        errorElement={<RouteErrorPage />}
      />
      <Route
        path="/users"
        element={<UserList />}
        errorElement={<RouteErrorPage />}
      />
      <Route
        path="/users/:username"
        element={<UserDetail />}
        errorElement={<RouteErrorPage />}
      />
      <Route
        path="/register"
        element={<RegisterPage />}
        errorElement={<RouteErrorPage />}
      />
      <Route path="/" element={<Navigate to="/agents" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>,
  ),
  { basename: ROUTER_BASENAME },
);

const AppRoot: React.FC = () => {
  useChartThemeSync();
  return (
    <>
      <Notifications />
      <StepUpPasswordPromptProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </StepUpPasswordPromptProvider>
    </>
  );
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider
        defaultColorScheme="dark"
        cssVariablesResolver={v8CssVariablesResolver}
      >
        <AppRoot />
      </MantineProvider>
    </QueryClientProvider>
  );
};

export default App;

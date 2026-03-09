import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { AppLayout } from "./components/AppLayout";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { OrderRunCreate } from "./pages/OrderRunCreate";
import { OrderRunDetail } from "./pages/OrderRunDetail";
import { OrderRunList } from "./pages/OrderRunList";
import { LoginPage } from "./pages/LoginPage";
import { PlanningOrderCreate } from "./pages/PlanningOrderCreate";
import { PlanningOrderDetail } from "./pages/PlanningOrderDetail";
import { PlanningOrderList } from "./pages/PlanningOrderList";
import { OrderRevisionDetail } from "./pages/OrderRevisionDetail";

const AppContent: React.FC = () => {
  const [publicRead, setPublicRead] = React.useState(false);
  const [clientConfigLoaded, setClientConfigLoaded] = React.useState(false);
  const { user, loading } = useAuth();

  // Fetch client config (publicRead) on mount
  React.useEffect(() => {
    fetch("/api/erp/client-config")
      .then((r) => r.json())
      .then((d) => setPublicRead(d.publicRead))
      .catch(() => {})
      .finally(() => setClientConfigLoaded(true));
  }, []);

  // Wait for both session check and client config to complete
  if (loading || !clientConfigLoaded) {
    return null;
  }

  // Show full-page login when not authenticated and public read is disabled
  if (!user && !publicRead) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<PlanningOrderList />} />
        <Route path="/orders/new" element={<PlanningOrderCreate />} />
        <Route path="/orders/:key" element={<PlanningOrderDetail />} />
        <Route
          path="/orders/:orderKey/revs/:revNo"
          element={<OrderRevisionDetail />}
        />
        <Route
          path="/orders/:orderKey/runs"
          element={<OrderRunList />}
        />
        <Route
          path="/orders/:orderKey/runs/new"
          element={<OrderRunCreate />}
        />
        <Route
          path="/orders/:orderKey/runs/:id"
          element={<OrderRunDetail />}
        />
      </Route>
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <MantineProvider defaultColorScheme="dark">
      <Notifications position="top-right" />
      <BrowserRouter basename="/erp">
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </MantineProvider>
  );
};

export default App;

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { AppLayout } from "./components/AppLayout";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { DispatchList } from "./pages/dispatch/DispatchList";
import { ItemCreate } from "./pages/items/ItemCreate";
import { ItemDetail } from "./pages/items/ItemDetail";
import { ItemList } from "./pages/items/ItemList";
import { LoginPage } from "./pages/LoginPage";
import { OrderCreate } from "./pages/orders/OrderCreate";
import { OrderDetail } from "./pages/orders/OrderDetail";
import { OrderList } from "./pages/orders/OrderList";
import { HeaderDetail } from "./pages/orders/revs/HeaderDetail";
import { OperationDetail } from "./pages/orders/revs/OperationDetail";
import { RevisionLayout } from "./pages/orders/revs/RevisionLayout";
import { HeaderRunDetail } from "./pages/orders/runs/HeaderRunDetail";
import { OperationRunDetail } from "./pages/orders/runs/OperationRunDetail";
import { OrderRunCreate } from "./pages/orders/runs/OrderRunCreate";
import { OrderRunLayout } from "./pages/orders/runs/OrderRunDetail";
import { OrderRunList } from "./pages/orders/runs/OrderRunList";
import { UserDetail } from "./pages/users/UserDetail";
import { UserList } from "./pages/users/UserList";

const AppContent: React.FC = () => {
  const [publicRead, setPublicRead] = React.useState(false);
  const [supervisorAuth, setSupervisorAuth] = React.useState(false);
  const [clientConfigLoaded, setClientConfigLoaded] = React.useState(false);
  const { user, loading } = useAuth();

  // Fetch client config on mount
  React.useEffect(() => {
    fetch("/api/erp/client-config")
      .then((r) => r.json())
      .then((d) => {
        setPublicRead(d.publicRead);
        setSupervisorAuth(d.supervisorAuth);
      })
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
      <Route element={<AppLayout supervisorAuth={supervisorAuth} />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrderList />} />
        <Route path="/orders/new" element={<OrderCreate />} />
        <Route path="/orders/:key" element={<OrderDetail />} />
        <Route
          path="/orders/:orderKey/revs/:revNo"
          element={<RevisionLayout />}
        >
          <Route index element={<Navigate to="header" replace />} />
          <Route path="header" element={<HeaderDetail />} />
          <Route path="ops/:seqNo" element={<OperationDetail />} />
        </Route>
        <Route path="/orders/:orderKey/runs" element={<OrderRunList />} />
        <Route path="/orders/:orderKey/runs/new" element={<OrderRunCreate />} />
        <Route
          path="/orders/:orderKey/runs/:runNo"
          element={<OrderRunLayout />}
        >
          <Route index element={<Navigate to="header" replace />} />
          <Route path="header" element={<HeaderRunDetail />} />
          <Route path="ops/:seqNo" element={<OperationRunDetail />} />
        </Route>
        <Route path="/items" element={<ItemList />} />
        <Route path="/items/new" element={<ItemCreate />} />
        <Route path="/items/:key" element={<ItemDetail />} />
        <Route path="/dispatch" element={<DispatchList />} />
        <Route path="/users" element={<UserList />} />
        <Route path="/users/:username" element={<UserDetail />} />
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

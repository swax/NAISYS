import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AppLayout } from "./components/AppLayout";
import { PlanningOrderList } from "./pages/PlanningOrderList";
import { PlanningOrderDetail } from "./pages/PlanningOrderDetail";
import { PlanningOrderCreate } from "./pages/PlanningOrderCreate";
import { ExecutionOrderList } from "./pages/ExecutionOrderList";
import { ExecutionOrderDetail } from "./pages/ExecutionOrderDetail";
import { ExecutionOrderCreate } from "./pages/ExecutionOrderCreate";

const App: React.FC = () => {
  return (
    <MantineProvider defaultColorScheme="dark">
      <Notifications position="top-right" />
      <BrowserRouter basename="/erp">
        <Routes>
          <Route element={<AppLayout />}>
            <Route
              path="/"
              element={<Navigate to="/planning/orders" replace />}
            />
            <Route
              path="/planning/orders"
              element={<PlanningOrderList />}
            />
            <Route
              path="/planning/orders/new"
              element={<PlanningOrderCreate />}
            />
            <Route
              path="/planning/orders/:id"
              element={<PlanningOrderDetail />}
            />
            <Route
              path="/execution/orders"
              element={<ExecutionOrderList />}
            />
            <Route
              path="/execution/orders/new"
              element={<ExecutionOrderCreate />}
            />
            <Route
              path="/execution/orders/:id"
              element={<ExecutionOrderDetail />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  );
};

export default App;
